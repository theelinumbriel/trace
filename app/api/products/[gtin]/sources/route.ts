import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  claimEvidence,
  evidence,
  products,
  shipments,
  supplyChainEvents,
} from "@/db/schema";
import { normalizeGtin } from "@/lib/gtin";
import { AppError, invalidBarcode, toResponse } from "@/lib/errors";
import { zSourcesResponse, type SourceCard } from "@/lib/schemas/api";

/**
 * GET /api/products/[gtin]/sources — every evidence row used to construct
 * the trace, with the claims each supports. Users can inspect precisely
 * where information came from.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gtin: string }> },
) {
  try {
    const { gtin } = await params;
    const normalized = normalizeGtin(gtin);
    if (!normalized) throw invalidBarcode();

    const db = await getDb();
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.gtin, normalized.gtin14))
      .limit(1);
    if (!product) throw new AppError("NOT_FOUND", 404, "Unknown product.");

    const events = await db
      .select({
        id: supplyChainEvents.id,
        eventType: supplyChainEvents.eventType,
        locationLabel: supplyChainEvents.locationLabel,
        shipmentId: supplyChainEvents.shipmentId,
      })
      .from(supplyChainEvents)
      .where(eq(supplyChainEvents.productId, product.id));
    const eventIds = events.map((e) => e.id);
    const eventById = new Map(events.map((e) => [e.id, e]));

    const links = eventIds.length
      ? await db
          .select()
          .from(claimEvidence)
          .where(inArray(claimEvidence.eventId, eventIds))
      : [];

    // Shipment source evidence (the NOT NULL FK) also belongs in Sources.
    const shipmentIds = [
      ...new Set(
        events.map((e) => e.shipmentId).filter((v): v is string => !!v),
      ),
    ];
    const shipmentRows = shipmentIds.length
      ? await db
          .select({
            id: shipments.id,
            sourceEvidenceId: shipments.sourceEvidenceId,
          })
          .from(shipments)
          .where(inArray(shipments.id, shipmentIds))
      : [];

    const claimsByEvidence = new Map<
      string,
      { eventId: string | null; title: string }[]
    >();
    const add = (evidenceId: string, eventId: string | null, title: string) => {
      const list = claimsByEvidence.get(evidenceId) ?? [];
      if (!list.some((c) => c.eventId === eventId && c.title === title)) {
        list.push({ eventId, title });
      }
      claimsByEvidence.set(evidenceId, list);
    };

    for (const l of links) {
      if (!l.eventId) continue;
      const e = eventById.get(l.eventId);
      if (e) add(l.evidenceId, l.eventId, e.locationLabel);
    }
    for (const s of shipmentRows) {
      const owner = events.find((e) => e.shipmentId === s.id);
      add(
        s.sourceEvidenceId,
        owner?.id ?? null,
        owner ? owner.locationLabel : "Shipment record",
      );
    }
    add(product.identityEvidenceId, null, "Product identity");

    const allIds = [...claimsByEvidence.keys()];
    const rows = allIds.length
      ? await db.select().from(evidence).where(inArray(evidence.id, allIds))
      : [];

    const sources: SourceCard[] = rows
      .map((e) => ({
        id: e.id,
        sourceName: e.sourceName,
        sourceType: e.sourceType,
        title: e.title,
        publisher: e.publisher,
        sourceUrl: e.sourceUrl,
        publicationDate: e.publicationDate,
        retrievedAt: e.retrievedAt.toISOString(),
        supportingText: e.supportingText,
        license: e.license,
        relevance: "primary",
        mock: e.providerId.includes("mock") || /\(mock\)/i.test(e.sourceName),
        needsVerification: e.needsVerification,
        claimsSupported: claimsByEvidence.get(e.id) ?? [],
      }))
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));

    return NextResponse.json(zSourcesResponse.parse({ sources }), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
