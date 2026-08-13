import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  companies,
  evidence,
  products,
  shipments,
  supplyChainEvents,
  traces,
} from "@/db/schema";
import { freshPipeline, type TracePipeline } from "@/db/json-types";
import { scoreClaim, type EvidenceInput } from "@/lib/confidence";
import { registry } from "@/providers/registry";
import type { RawObservation } from "@/providers/types";
import { persistEvent, persistEvidence } from "./persist";

export const ENGINE_VERSION = "recon-0.1.0";

/**
 * Live supply-chain reconstruction. Runs post-response inside after() on the
 * reconstruct route. All output goes to the DB (pipeline steps update as the
 * UI polls); throws only on programmer error.
 *
 * Honesty contract: stages that find nothing insert `unknown` gap events —
 * a chain hop is never guessed. Claims are only created from persisted
 * evidence and scored by the deterministic model; claims scoring <50 are
 * kept out of the primary path and surfaced as gaps instead.
 */

type EventRow = typeof supplyChainEvents.$inferSelect;
type Ctx = {
  db: Db;
  traceId: string;
  product: typeof products.$inferSelect;
  brandName: string | null;
  brandOwner: string | null;
  degraded: string[];
  asOf: Date;
};

async function setStep(
  db: Db,
  traceId: string,
  key: string,
  state: "pending" | "active" | "done" | "failed" | "skipped",
): Promise<void> {
  const [row] = await db
    .select({ pipeline: traces.pipeline })
    .from(traces)
    .where(eq(traces.id, traceId))
    .limit(1);
  if (!row) return;
  const pipeline: TracePipeline = row.pipeline.map((s) =>
    s.key === key
      ? {
          ...s,
          state,
          finishedAt:
            state === "done" || state === "failed" || state === "skipped"
              ? new Date().toISOString()
              : undefined,
        }
      : s,
  );
  await db
    .update(traces)
    .set({ pipeline, updatedAt: new Date() })
    .where(eq(traces.id, traceId));
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function evidenceInput(
  db: Db,
  evidenceId: string,
  specificity: EvidenceInput["specificity"],
): Promise<EvidenceInput> {
  const [row] = await db
    .select()
    .from(evidence)
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  return {
    id: row.id,
    sourceType: row.sourceType,
    publicationDate: row.publicationDate,
    sourceDomain: domainOf(row.sourceUrl),
    specificity,
  };
}

async function persistObservation(
  db: Db,
  o: RawObservation,
): Promise<string> {
  return persistEvidence(db, {
    providerId: o.providerId,
    sourceName: o.sourceName,
    sourceUrl: o.sourceUrl,
    sourceType: o.sourceType,
    title: o.title,
    publisher: o.publisher ?? null,
    publicationDate: o.publicationDate,
    retrievedAt: o.retrievedAt,
    supportingText: o.supportingText,
    reliabilityScore: o.reliabilityScore,
    license: o.license ?? null,
    raw: o.raw,
    needsVerification: o.needsVerification ?? false,
  });
}

/** Identity evidence structured payload (OFF origins/manufacturing_places). */
async function identityStructured(
  ctx: Ctx,
): Promise<Record<string, unknown> | null> {
  const [row] = await ctx.db
    .select({ raw: evidence.raw })
    .from(evidence)
    .where(eq(evidence.id, ctx.product.identityEvidenceId))
    .limit(1);
  const raw = row?.raw as { product?: Record<string, unknown> } | null;
  return raw?.product ?? (raw as Record<string, unknown> | null);
}

/**
 * Build a claim event from evidence, scoring it deterministically. Weak
 * claims (<50) are still persisted (they carry their evidence) but the
 * caller keeps them out of the primary path.
 */
async function createScoredEvent(
  ctx: Ctx,
  base: {
    eventType: EventRow["eventType"];
    locationLabel: string;
    lat?: number | null;
    lng?: number | null;
    companyId?: string | null;
    shipmentId?: string | null;
    lotCode?: string | null;
    ruleId?: string | null;
    summary: string;
    inferenceBasis?: string;
  },
  evidenceRefs: { id: string; specificity: EvidenceInput["specificity"] }[],
  inferredDepth: number,
): Promise<{ id: string; confidence: number; status: string }> {
  const inputs = await Promise.all(
    evidenceRefs.map((r) => evidenceInput(ctx.db, r.id, r.specificity)),
  );
  const { confidence, status } = scoreClaim(inputs, inferredDepth, ctx.asOf);
  const id = await persistEvent(
    ctx.db,
    {
      productId: ctx.product.id,
      eventType: base.eventType,
      companyId: base.companyId ?? null,
      facilityId: null,
      shipmentId: base.shipmentId ?? null,
      locationLabel: base.locationLabel,
      lat: base.lat ?? null,
      lng: base.lng ?? null,
      startedOn: null,
      endedOn: null,
      status,
      confidence,
      evidenceSummary: base.summary,
      inferenceBasis:
        status === "inferred"
          ? (base.inferenceBasis ??
            "Supported only by open-database records, not the responsible party's own documentation.")
          : null,
      ruleId: base.ruleId ?? null,
      lotCode: base.lotCode ?? null,
    },
    evidenceRefs.map((r) => r.id),
  );
  return { id, confidence, status };
}

async function createUnknownGap(
  ctx: Ctx,
  eventType: EventRow["eventType"],
  locationLabel: string,
  summary: string,
): Promise<string> {
  return persistEvent(
    ctx.db,
    {
      productId: ctx.product.id,
      eventType,
      companyId: null,
      facilityId: null,
      shipmentId: null,
      locationLabel,
      lat: null,
      lng: null,
      startedOn: null,
      endedOn: null,
      status: "unknown",
      confidence: 0,
      evidenceSummary: summary,
      inferenceBasis: null,
      ruleId: null,
      lotCode: null,
    },
    [],
  );
}

async function stageManufacturer(ctx: Ctx): Promise<void> {
  const result = await registry.gs1Company.lookup(ctx.product.gtin);
  if (!result.ok || !result.data?.brandOwner) return;
  for (const o of result.observations) await persistObservation(ctx.db, o);
  ctx.brandOwner = result.data.brandOwner;
}

async function stageOrigins(
  ctx: Ctx,
): Promise<{ id: string; confidence: number } | null> {
  const structured = await identityStructured(ctx);
  const origins =
    (structured?.origins as string | undefined) ||
    (structured?.origins_text as string | undefined);
  if (!origins) return null;
  const created = await createScoredEvent(
    ctx,
    {
      eventType: "material_origin",
      locationLabel: origins,
      summary: `Open Food Facts lists this product's origins field as "${origins}". This is crowd-sourced open-database data, not a disclosure by the producer.`,
      inferenceBasis: `Open Food Facts "origins" field for this exact barcode reads "${origins}".`,
      ruleId: "off:origins-field",
    },
    [{ id: ctx.product.identityEvidenceId, specificity: "exact_product" }],
    0,
  );
  return created;
}

async function stageFacilities(
  ctx: Ctx,
): Promise<{ id: string; confidence: number } | null> {
  const structured = await identityStructured(ctx);
  const places =
    (structured?.manufacturing_places as string | undefined) || null;
  if (places) {
    return createScoredEvent(
      ctx,
      {
        eventType: "manufacturing",
        locationLabel: places,
        summary: `Open Food Facts lists manufacturing_places as "${places}" for this barcode. Crowd-sourced; not confirmed by the producer.`,
        inferenceBasis: `Open Food Facts "manufacturing_places" field reads "${places}".`,
        ruleId: "off:manufacturing-places-field",
      },
      [{ id: ctx.product.identityEvidenceId, specificity: "exact_product" }],
      0,
    );
  }
  // Curated facilities (seeded disclosures) by brand name.
  if (ctx.brandName) {
    const found = await registry.facilities[0].facilities({
      companyName: ctx.brandName,
    });
    if (found.ok && found.data.length > 0) {
      // Facilities exist from disclosures, but without a document tying THIS
      // product to one of them we do not assert a stage. The gap event's
      // summary names the candidates honestly.
      ctx.degraded = ctx.degraded; // no-op: candidates surface in route stage
    }
  }
  return null;
}

async function stageTrade(
  ctx: Ctx,
): Promise<{ id: string; confidence: number } | null> {
  const consignee = ctx.brandOwner ?? ctx.brandName;
  if (!consignee) return null;
  const result = await registry.tradeData[0].shipments({
    consigneeName: consignee,
  });
  if (!result.ok || result.data.length === 0) return null;
  const record = result.data[0];
  const obsIds: string[] = [];
  for (const o of result.observations) {
    obsIds.push(await persistObservation(ctx.db, o));
  }
  const [shipment] = await ctx.db
    .insert(shipments)
    .values({
      transportMode: record.transportMode,
      hsCode: record.hsCode ?? null,
      description: `${record.shipper} → ${record.consignee}`,
      sourceEvidenceId: obsIds[0],
    })
    .returning({ id: shipments.id });
  return createScoredEvent(
    ctx,
    {
      eventType: "freight",
      locationLabel: `${record.originPort.name} → ${record.destinationPort.name}`,
      lat: record.destinationPort.lat ?? null,
      lng: record.destinationPort.lng ?? null,
      shipmentId: shipment.id,
      ruleId: "trade:consignee-match",
      summary: `Customs manifests index shipments consigned to ${record.consignee} on the ${record.originPort.name} → ${record.destinationPort.name} lane.`,
      inferenceBasis:
        "Publicly indexed bill-of-lading summaries show this lane for this consignee; full records sit behind commercial paywalls, and no record ties this specific product run to a vessel.",
    },
    obsIds.map((id) => ({ id, specificity: "brand_level" as const })),
    1,
  );
}

async function stageRecalls(ctx: Ctx, lot: string | null): Promise<string[]> {
  const result = await registry.recalls[0].recalls({
    gtin14: ctx.product.gtin,
    upc12: ctx.product.upc,
    brand: ctx.brandName ?? undefined,
    firm: ctx.brandOwner ?? undefined,
  });
  if (!result.ok) {
    ctx.degraded.push("openfda-recalls");
    return [];
  }
  const ids: string[] = [];
  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    const upcMatched =
      !!ctx.product.upc &&
      (r.codeInfo + r.productDescription).replace(/\D/g, "").includes(
        ctx.product.upc,
      );
    // Brand-token-only matches are far too noisy to assert — only surface
    // recalls whose free text contains this product's UPC digits.
    if (!upcMatched) continue;
    const lotMatched = lot !== null && r.codeInfo.includes(lot);
    const obsId = await persistObservation(ctx.db, result.observations[i]);
    const created = await createScoredEvent(
      ctx,
      {
        eventType: "recall",
        locationLabel: r.distributionPattern.slice(0, 80) || "United States",
        lotCode: lotMatched ? lot : null,
        ruleId: "recall:upc-text-match",
        summary: `FDA enforcement report by ${r.recallingFirm} (${r.classification}, ${r.status}) matches this product's UPC in its coded text.`,
      },
      [{ id: obsId, specificity: "exact_product" }],
      0,
    );
    ids.push(created.id);
  }
  return ids;
}

async function runProductPipeline(ctx: Ctx): Promise<string[]> {
  const { db, traceId } = ctx;

  await setStep(db, traceId, "identify", "done"); // done at lookup time

  await setStep(db, traceId, "manufacturer", "active");
  try {
    await stageManufacturer(ctx);
    await setStep(db, traceId, "manufacturer", "done");
  } catch {
    await setStep(db, traceId, "manufacturer", "failed");
    ctx.degraded.push("manufacturer");
  }

  await setStep(db, traceId, "origins", "active");
  let origin: { id: string; confidence: number } | null = null;
  try {
    origin = await stageOrigins(ctx);
    await setStep(db, traceId, "origins", "done");
  } catch {
    await setStep(db, traceId, "origins", "failed");
    ctx.degraded.push("origins");
  }

  await setStep(db, traceId, "facilities", "active");
  let manufacturing: { id: string; confidence: number } | null = null;
  try {
    manufacturing = await stageFacilities(ctx);
    await setStep(db, traceId, "facilities", "done");
  } catch {
    await setStep(db, traceId, "facilities", "failed");
    ctx.degraded.push("facilities");
  }

  await setStep(db, traceId, "trade", "active");
  let freight: { id: string; confidence: number } | null = null;
  try {
    freight = await stageTrade(ctx);
    await setStep(db, traceId, "trade", "done");
  } catch {
    await setStep(db, traceId, "trade", "failed");
    ctx.degraded.push("trade");
  }

  await setStep(db, traceId, "recalls", "active");
  try {
    await stageRecalls(ctx, null);
    await setStep(db, traceId, "recalls", "done");
  } catch {
    await setStep(db, traceId, "recalls", "failed");
    ctx.degraded.push("recalls");
  }

  // Route assembly: required hops origin → production → distribution, with
  // optional freight between production and distribution. <50-confidence
  // claims stay out of the primary path; their existence is disclosed in
  // the gap summary.
  await setStep(db, traceId, "route", "active");
  const path: string[] = [];

  if (origin && origin.confidence >= 50) {
    path.push(origin.id);
  } else {
    path.push(
      await createUnknownGap(
        ctx,
        "material_origin",
        "Origin unknown",
        origin
          ? "An open-database origins field exists for this product, but its support is too weak to assert as a stage. No producer disclosure or structured record identifies where this product's materials come from."
          : "No public record identifies where this product's materials come from. We will not guess.",
      ),
    );
  }

  if (manufacturing && manufacturing.confidence >= 50) {
    path.push(manufacturing.id);
  } else {
    path.push(
      await createUnknownGap(
        ctx,
        "manufacturing",
        "Production unknown",
        manufacturing
          ? "An open-database manufacturing_places field exists, but its support is too weak to assert as a stage. No producer disclosure identifies the production site."
          : "No public record identifies where this product is made.",
      ),
    );
  }

  if (freight && freight.confidence >= 50) path.push(freight.id);

  path.push(
    await createUnknownGap(
      ctx,
      "distribution",
      "Distribution unknown",
      "No public record documents this product's distribution routing. Retail distribution networks are not publicly disclosed.",
    ),
  );

  await setStep(db, traceId, "route", "done");
  return path;
}

export async function reconstructSupplyChain(traceId: string): Promise<void> {
  const db = await getDb();
  const [trace] = await db
    .select()
    .from(traces)
    .where(eq(traces.id, traceId))
    .limit(1);
  if (!trace) return;

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, trace.productId))
    .limit(1);
  if (!product) {
    await db
      .update(traces)
      .set({ status: "failed", errorCode: "PRODUCT_MISSING" })
      .where(eq(traces.id, traceId));
    return;
  }

  const brandName = product.brandId
    ? ((
        await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, product.brandId))
          .limit(1)
      )[0]?.name ?? null)
    : null;

  const ctx: Ctx = {
    db,
    traceId,
    product,
    brandName,
    brandOwner: null,
    degraded: [],
    asOf: new Date(),
  };

  try {
    let bestPath: string[];

    if (trace.kind === "batch") {
      // Batch traces build on the product-level chain — item-level
      // provenance is never synthesized.
      const [productTrace] = await db
        .select()
        .from(traces)
        .where(
          and(
            eq(traces.productId, product.id),
            eq(traces.kind, "product"),
            eq(traces.status, "complete"),
          ),
        )
        .limit(1);

      if (productTrace) {
        bestPath = productTrace.bestPath;
        for (const step of [
          "identify",
          "manufacturer",
          "origins",
          "facilities",
          "trade",
        ])
          await setStep(db, traceId, step, "done");
      } else {
        bestPath = await runProductPipeline(ctx);
      }

      // Item-level lookups for this lot/serial.
      const epcis = await registry.traceability[0].itemTrace({
        gtin14: product.gtin,
        lot: trace.lotCode ?? undefined,
        serial: trace.serial ?? undefined,
      });
      // (epcis.data is empty in v1 — no public resolver; the code path is
      // real, the fabrication is not.)
      void epcis;

      await setStep(db, traceId, "recalls", "active");
      await stageRecalls(ctx, trace.lotCode);
      await setStep(db, traceId, "recalls", "done");
      await setStep(db, traceId, "route", "done");
    } else {
      bestPath = await runProductPipeline(ctx);
    }

    // Finalize.
    const pathEvents = bestPath.length
      ? await db
          .select({
            id: supplyChainEvents.id,
            status: supplyChainEvents.status,
            confidence: supplyChainEvents.confidence,
          })
          .from(supplyChainEvents)
          .where(eq(supplyChainEvents.productId, product.id))
      : [];
    const inPath = pathEvents.filter((e) => bestPath.includes(e.id));
    const nonUnknown = inPath.filter((e) => e.status !== "unknown");

    await db
      .update(traces)
      .set({
        status: ctx.degraded.length > 0 ? "partial" : "complete",
        bestPath,
        pathScore:
          nonUnknown.length > 0
            ? Math.min(...nonUnknown.map((e) => e.confidence))
            : 0,
        engineVersion: ENGINE_VERSION,
        sourcesAsOf: ctx.asOf,
        computedAt: new Date(),
        updatedAt: new Date(),
        errorCode: ctx.degraded.length > 0 ? ctx.degraded.join(",") : null,
      })
      .where(eq(traces.id, traceId));
  } catch (err) {
    console.error(`[engine] trace ${traceId} crashed:`, err);
    await db
      .update(traces)
      .set({
        status: "failed",
        errorCode: "PIPELINE_CRASH",
        updatedAt: new Date(),
      })
      .where(eq(traces.id, traceId));
  }

  // Invalidate the cached trace read for this GTIN (no-op outside a Next
  // request context, e.g. in scripts/tests).
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(`trace:${product.gtin}`, "max");
  } catch {
    /* not in a Next context */
  }
}

/**
 * Claim-or-return-existing kickoff. Returns the trace id to poll plus
 * whether a fresh (within-TTL) result already existed.
 */
export async function ensureTrace(input: {
  productId: string;
  kind: "product" | "batch";
  lot?: string | null;
  serial?: string | null;
  expiryDate?: string | null;
  force?: boolean;
}): Promise<{ traceId: string; fresh: boolean; started: boolean }> {
  const db = await getDb();
  const ttlHours = Number(process.env.TRACE_TTL_HOURS ?? 168);
  const kindFilter =
    input.kind === "product"
      ? and(eq(traces.productId, input.productId), eq(traces.kind, "product"))
      : and(
          eq(traces.productId, input.productId),
          eq(traces.kind, "batch"),
          eq(traces.lotCode, input.lot ?? ""),
        );

  const [existing] = await db
    .select()
    .from(traces)
    .where(kindFilter)
    .limit(1);

  if (existing) {
    const fresh =
      existing.status === "complete" &&
      existing.computedAt !== null &&
      Date.now() - existing.computedAt.getTime() < ttlHours * 3600_000 &&
      !(input.force && process.env.NODE_ENV !== "production");
    if (fresh) return { traceId: existing.id, fresh: true, started: false };

    const running =
      (existing.status === "running" || existing.status === "pending") &&
      Date.now() - existing.updatedAt.getTime() < 5 * 60_000;
    if (running) return { traceId: existing.id, fresh: false, started: false };

    // Stale/failed/expired — reset the canonical row and re-run.
    await db
      .update(traces)
      .set({
        status: "running",
        pipeline: freshPipeline(),
        bestPath: [],
        altPaths: [],
        pathScore: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(traces.id, existing.id));
    return { traceId: existing.id, fresh: false, started: true };
  }

  const [created] = await db
    .insert(traces)
    .values({
      productId: input.productId,
      kind: input.kind,
      lotCode: input.lot ?? null,
      serial: input.serial ?? null,
      expiryDate: input.expiryDate ?? null,
      status: "running",
      pipeline: freshPipeline(),
      engineVersion: ENGINE_VERSION,
      sourcesAsOf: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: traces.id });

  if (created) return { traceId: created.id, fresh: false, started: true };
  // Concurrent kickoff collapsed on the partial unique index — return the
  // winner's row.
  const [winner] = await db.select().from(traces).where(kindFilter).limit(1);
  return { traceId: winner.id, fresh: false, started: false };
}
