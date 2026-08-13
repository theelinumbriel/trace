/**
 * Seed loader. Reads db/seed-data/*.json, validates EVERY file against
 * SeedFileSchema before touching the database, then loads all products in
 * one transaction through the same persistEvent write gate the live engine
 * uses. Any integrity failure rolls back everything.
 *
 * Usage:
 *   npm run db:seed            # upsert all seed products
 *   npm run db:seed -- --reset # truncate trace tables first
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { inArray, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { SeedFileSchema, type SeedFile } from "../db/seed-schema";
import {
  persistEvidence,
  persistEvent,
  linkMaterialEvidence,
  linkShipmentEvidence,
} from "../lib/engine/persist";
import { canonicalKey, slugify } from "../lib/canonical";
import { freshPipeline, type TracePipeline } from "../db/json-types";
import type { Db } from "../db/client";

const SEED_DIR = path.join(process.cwd(), "db", "seed-data");
const RESET = process.argv.includes("--reset");

type TxLike = Db;

async function makeSeedDb(): Promise<{
  db: unknown;
  transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
}> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url, max: 1 });
    const db = drizzle(pool, { schema });
    return {
      db,
      transaction: (fn) =>
        db.transaction((tx) => fn(tx as unknown as TxLike)),
      end: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(path.join(process.cwd(), ".pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "db", "migrations"),
  });
  return {
    db,
    transaction: (fn) => db.transaction((tx) => fn(tx as unknown as TxLike)),
    end: () => client.close(),
  };
}

function loadSeedFiles(): { name: string; data: SeedFile }[] {
  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`no seed files in ${SEED_DIR}`);
  const parsed: { name: string; data: SeedFile }[] = [];
  const failures: string[] = [];
  for (const name of files.sort()) {
    const raw = JSON.parse(readFileSync(path.join(SEED_DIR, name), "utf8"));
    const result = SeedFileSchema.safeParse(raw);
    if (!result.success) {
      failures.push(
        `${name}:\n${result.error.issues
          .map((i) => `  - [${i.path.join(".")}] ${i.message}`)
          .join("\n")}`,
      );
    } else {
      parsed.push({ name, data: result.data });
    }
  }
  if (failures.length > 0) {
    throw new Error(`Seed validation failed:\n${failures.join("\n")}`);
  }
  return parsed;
}

async function upsertCompanies(tx: TxLike, file: SeedFile) {
  const ids = new Map<string, string>();
  // Two passes so parentKey can reference any company in the file.
  for (const c of file.companies) {
    const [row] = await tx
      .insert(schema.companies)
      .values({
        slug: slugify(c.key),
        name: c.name,
        canonicalKey: canonicalKey(c.name),
        website: c.website ?? null,
        country: c.country ?? null,
        companyType: c.companyType,
      })
      .onConflictDoUpdate({
        target: schema.companies.slug,
        set: {
          name: c.name,
          canonicalKey: canonicalKey(c.name),
          website: c.website ?? null,
          country: c.country ?? null,
          companyType: c.companyType,
        },
      })
      .returning({ id: schema.companies.id });
    ids.set(c.key, row.id);
  }
  for (const c of file.companies) {
    if (!c.parentKey) continue;
    const parentId = ids.get(c.parentKey);
    if (!parentId) throw new Error(`${c.key}: unknown parent ${c.parentKey}`);
    await tx
      .update(schema.companies)
      .set({ parentCompanyId: parentId })
      .where(eq(schema.companies.id, ids.get(c.key)!));
  }
  return ids;
}

async function upsertFacilities(
  tx: TxLike,
  file: SeedFile,
  companyIds: Map<string, string>,
) {
  const ids = new Map<string, string>();
  for (const f of file.facilities) {
    const companyId = f.companyKey ? companyIds.get(f.companyKey) : null;
    if (f.companyKey && !companyId)
      throw new Error(`${f.key}: unknown company ${f.companyKey}`);
    const [row] = await tx
      .insert(schema.facilities)
      .values({
        slug: slugify(f.key),
        companyId: companyId ?? null,
        name: f.name,
        facilityType: f.facilityType,
        city: f.city ?? null,
        region: f.region ?? null,
        country: f.country,
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        osId: f.osId ?? null,
        unlocode: f.unlocode ?? null,
      })
      .onConflictDoUpdate({
        target: schema.facilities.slug,
        set: {
          companyId: companyId ?? null,
          name: f.name,
          facilityType: f.facilityType,
          city: f.city ?? null,
          region: f.region ?? null,
          country: f.country,
          lat: f.lat ?? null,
          lng: f.lng ?? null,
          osId: f.osId ?? null,
          unlocode: f.unlocode ?? null,
        },
      })
      .returning({ id: schema.facilities.id });
    ids.set(f.key, row.id);
  }
  return ids;
}

async function loadProduct(tx: TxLike, file: SeedFile, retrievedAt: Date) {
  const companyIds = await upsertCompanies(tx, file);
  const facilityIds = await upsertFacilities(tx, file, companyIds);

  // Evidence (deduped, insert-only).
  const evidenceIds = new Map<string, string>();
  for (const e of file.evidence) {
    const id = await persistEvidence(tx, {
      providerId: "seed",
      sourceName: e.sourceName,
      sourceUrl: e.sourceUrl,
      sourceType: e.sourceType,
      title: e.title,
      publisher: e.publisher ?? null,
      publicationDate: e.publicationDate ?? null,
      retrievedAt,
      supportingText: e.supportingText,
      reliabilityScore: e.reliabilityScore,
      license: e.license ?? null,
      needsVerification: e.needsVerification,
    });
    evidenceIds.set(e.key, id);
  }

  // Materials.
  const materialIds = new Map<string, string>();
  for (const m of file.materials) {
    const [row] = await tx
      .insert(schema.materials)
      .values({
        slug: slugify(m.key),
        name: m.name,
        category: m.category ?? null,
        hsCode: m.hsCode ?? null,
      })
      .onConflictDoUpdate({
        target: schema.materials.slug,
        set: { name: m.name, category: m.category ?? null },
      })
      .returning({ id: schema.materials.id });
    materialIds.set(m.key, row.id);
  }

  // Product (idempotent on gtin).
  const identityEvidenceId = evidenceIds.get(file.product.identityEvidenceKey)!;
  const [product] = await tx
    .insert(schema.products)
    .values({
      gtin: file.product.gtin,
      upc: file.product.upc ?? null,
      name: file.product.name,
      brandId: companyIds.get(file.product.brandKey)!,
      manufacturerId: file.product.manufacturerKey
        ? (companyIds.get(file.product.manufacturerKey) ?? null)
        : null,
      category: file.product.category,
      imageUrl: file.product.imageUrl ?? null,
      description: file.product.description ?? null,
      ingredientsText: file.product.ingredientsText ?? null,
      identityEvidenceId,
    })
    .onConflictDoUpdate({
      target: schema.products.gtin,
      set: {
        upc: file.product.upc ?? null,
        name: file.product.name,
        brandId: companyIds.get(file.product.brandKey)!,
        manufacturerId: file.product.manufacturerKey
          ? (companyIds.get(file.product.manufacturerKey) ?? null)
          : null,
        category: file.product.category,
        imageUrl: file.product.imageUrl ?? null,
        description: file.product.description ?? null,
        ingredientsText: file.product.ingredientsText ?? null,
        identityEvidenceId,
        updatedAt: retrievedAt,
      },
    })
    .returning({ id: schema.products.id });

  // Idempotent re-runs: clear this product's previous events (+ their
  // shipments) and traces, then re-insert. Seeds own these rows.
  const oldEvents = await tx
    .select({
      id: schema.supplyChainEvents.id,
      shipmentId: schema.supplyChainEvents.shipmentId,
    })
    .from(schema.supplyChainEvents)
    .where(eq(schema.supplyChainEvents.productId, product.id));
  const oldShipmentIds = oldEvents
    .map((e) => e.shipmentId)
    .filter((v): v is string => v !== null);
  await tx
    .delete(schema.supplyChainEvents)
    .where(eq(schema.supplyChainEvents.productId, product.id));
  if (oldShipmentIds.length > 0) {
    await tx
      .delete(schema.shipments)
      .where(inArray(schema.shipments.id, oldShipmentIds));
  }
  await tx
    .delete(schema.productMaterials)
    .where(eq(schema.productMaterials.productId, product.id));
  await tx
    .delete(schema.traces)
    .where(eq(schema.traces.productId, product.id));

  // Product-material origin claims.
  for (const pm of file.productMaterials) {
    const [row] = await tx
      .insert(schema.productMaterials)
      .values({
        productId: product.id,
        materialId: materialIds.get(pm.materialKey)!,
        role: pm.role,
        originCountry: pm.originCountry ?? null,
        originNote: pm.originNote ?? null,
        status: pm.status,
        confidence: pm.confidence,
      })
      .returning({ id: schema.productMaterials.id });
    await linkMaterialEvidence(
      tx,
      row.id,
      pm.evidence.map((k) => evidenceIds.get(k)!),
    );
  }

  // Shipments (evidence-required at the schema level).
  const shipmentIds = new Map<string, string>();
  for (const s of file.shipments) {
    const [row] = await tx
      .insert(schema.shipments)
      .values({
        originFacilityId: s.originFacilityKey
          ? (facilityIds.get(s.originFacilityKey) ?? null)
          : null,
        destinationFacilityId: s.destinationFacilityKey
          ? (facilityIds.get(s.destinationFacilityKey) ?? null)
          : null,
        originPortId: s.originPortKey
          ? (facilityIds.get(s.originPortKey) ?? null)
          : null,
        destinationPortId: s.destinationPortKey
          ? (facilityIds.get(s.destinationPortKey) ?? null)
          : null,
        transportMode: s.transportMode,
        departedOn: s.departedOn ?? null,
        arrivedOn: s.arrivedOn ?? null,
        hsCode: s.hsCode ?? null,
        description: s.description ?? null,
        sourceEvidenceId: evidenceIds.get(s.sourceEvidenceKey)!,
      })
      .returning({ id: schema.shipments.id });
    shipmentIds.set(s.key, row.id);
    await linkShipmentEvidence(
      tx,
      row.id,
      s.corroboratingEvidence.map((k) => evidenceIds.get(k)!),
    );
  }

  // Events — through the same write gate as the live engine.
  const eventIds = new Map<string, string>();
  for (const e of file.events) {
    const id = await persistEvent(
      tx,
      {
        productId: product.id,
        eventType: e.eventType,
        companyId: e.companyKey
          ? (companyIds.get(e.companyKey) ?? null)
          : null,
        facilityId: e.facilityKey
          ? (facilityIds.get(e.facilityKey) ?? null)
          : null,
        shipmentId: e.shipmentKey
          ? (shipmentIds.get(e.shipmentKey) ?? null)
          : null,
        locationLabel: e.locationLabel,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
        startedOn: e.startedOn ?? null,
        endedOn: e.endedOn ?? null,
        status: e.status,
        confidence: e.confidence,
        evidenceSummary: e.evidenceSummary,
        inferenceBasis: e.inferenceBasis ?? null,
        ruleId: null,
        lotCode: e.lotCode ?? null,
      },
      e.evidence.map((k) => evidenceIds.get(k)!),
    );
    eventIds.set(e.key, id);
  }

  // Canonical product-level trace, born complete.
  const pipeline: TracePipeline = freshPipeline().map((s) => ({
    ...s,
    state: "done" as const,
  }));
  const pathEvents = file.bestPath.map((k) => eventIds.get(k)!);
  const nonUnknown = file.events.filter(
    (e) => file.bestPath.includes(e.key) && e.status !== "unknown",
  );
  await tx.insert(schema.traces).values({
    productId: product.id,
    kind: "product",
    status: "complete",
    pipeline,
    bestPath: pathEvents,
    altPaths: file.altPaths.map((a) => ({
      eventIds: a.eventKeys.map((k) => eventIds.get(k)!),
      score: a.score,
      label: a.label,
    })),
    pathScore:
      nonUnknown.length > 0
        ? Math.min(...nonUnknown.map((e) => e.confidence))
        : 0,
    engineVersion: "seed-1",
    sourcesAsOf: retrievedAt,
    computedAt: retrievedAt,
  });

  return {
    productId: product.id,
    gtin: file.product.gtin,
    name: file.product.name,
    events: file.events.length,
    byStatus: file.events.reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    }, {}),
    evidence: file.evidence.length,
    needsVerification: file.evidence.filter((e) => e.needsVerification).length,
  };
}

async function assertIntegrity(tx: TxLike) {
  // (a) No non-unknown event without evidence links.
  const orphans = await tx.execute(sql`
    SELECT e.id, e.location_label FROM supply_chain_events e
    WHERE e.status <> 'unknown'
      AND NOT EXISTS (SELECT 1 FROM claim_evidence ce WHERE ce.event_id = e.id)
  `);
  const orphanRows = (orphans as unknown as { rows: unknown[] }).rows ?? orphans;
  if (Array.isArray(orphanRows) && orphanRows.length > 0) {
    throw new Error(
      `integrity assertion failed: ${orphanRows.length} sourced-looking event(s) without evidence`,
    );
  }
  // (b) Every best_path element resolves to an event of the same product.
  const badPaths = await tx.execute(sql`
    SELECT t.id FROM traces t, jsonb_array_elements_text(t.best_path) AS pe(event_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM supply_chain_events e
      WHERE e.id = pe.event_id::uuid AND e.product_id = t.product_id
    )
  `);
  const badRows = (badPaths as unknown as { rows: unknown[] }).rows ?? badPaths;
  if (Array.isArray(badRows) && badRows.length > 0) {
    throw new Error(
      `integrity assertion failed: ${badRows.length} trace path element(s) don't resolve`,
    );
  }
}

async function main() {
  const files = loadSeedFiles();
  console.log(`Validated ${files.length} seed file(s).`);
  const { transaction, end } = await makeSeedDb();
  const retrievedAt = new Date();

  try {
    const summaries = await transaction(async (tx) => {
      if (RESET) {
        await tx.execute(sql`
          TRUNCATE claim_evidence, supply_chain_events, shipments, traces,
            scans, product_materials, products, evidence, materials,
            facilities, companies, provider_fetches CASCADE
        `);
        console.log("Reset: truncated all trace tables.");
      }
      const out = [];
      for (const f of files) {
        out.push(await loadProduct(tx, f.data, retrievedAt));
      }
      await assertIntegrity(tx);
      return out;
    });

    console.log("\nSeeded products:");
    for (const s of summaries) {
      const statuses = Object.entries(s.byStatus)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      console.log(
        `  ${s.gtin}  ${s.name}\n    events: ${s.events} (${statuses}) · evidence: ${s.evidence}` +
          (s.needsVerification > 0
            ? ` · ⚠ ${s.needsVerification} evidence row(s) flagged needs_verification`
            : ""),
      );
    }
    console.log("\nIntegrity assertions passed. Done.");
  } finally {
    await end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
