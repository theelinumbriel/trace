import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  claimEvidence,
  evidence,
  shipments,
  supplyChainEvents,
  traces,
} from "@/db/schema";
import type {
  EvidenceCard,
  StatusCounts,
  TraceEvent,
  TraceView,
} from "@/lib/schemas/api";

/**
 * THE read gate. All trace rendering flows through serializeTrace, which
 * joins events → claim_evidence → evidence and enforces, as defense in
 * depth, that no sourced-looking stage can render without sources: any
 * non-unknown event with zero surviving evidence rows is DEMOTED to
 * unknown at render time (confidence 0, integrity notice) and logged.
 */

type EventRow = typeof supplyChainEvents.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;
type ClaimRow = typeof claimEvidence.$inferSelect;
type ShipmentRow = typeof shipments.$inferSelect;

const TITLE_BY_TYPE: Record<EventRow["eventType"], string> = {
  material_origin: "Origin",
  processing: "Processing",
  manufacturing: "Production",
  packaging: "Packaging",
  export: "Export",
  freight: "Freight",
  import: "Import",
  distribution: "Distribution",
  retail: "Retail",
  recall: "Recall notice",
};

function eventTitle(row: EventRow, shipment: ShipmentRow | undefined): string {
  if (row.eventType === "freight" && shipment) {
    if (shipment.transportMode === "ocean") return "Ocean freight";
    if (shipment.transportMode === "air") return "Air freight";
  }
  return TITLE_BY_TYPE[row.eventType];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function dateRange(row: EventRow): string | null {
  if (row.startedOn && row.endedOn && row.startedOn !== row.endedOn) {
    return `${fmtMonth(row.startedOn)} – ${fmtMonth(row.endedOn)}`;
  }
  const d = row.startedOn ?? row.endedOn;
  return d ? fmtMonth(d) : null;
}

function isMockEvidence(e: EvidenceRow): boolean {
  return e.providerId.includes("mock") || /\(mock\)/i.test(e.sourceName);
}

function toCard(e: EvidenceRow, relevance: string): EvidenceCard {
  return {
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
    relevance,
    mock: isMockEvidence(e),
    needsVerification: e.needsVerification,
  };
}

function toEvent(
  row: EventRow,
  seq: number,
  cards: EvidenceCard[],
  shipment: ShipmentRow | undefined,
): TraceEvent {
  const demoted = row.status !== "unknown" && cards.length === 0;
  if (demoted) {
    console.error(
      `[integrity] event ${row.id} ("${row.locationLabel}", ${row.status}) ` +
        `has no evidence rows — demoted to unknown at render time`,
    );
  }
  return {
    id: row.id,
    seq,
    eventType: row.eventType,
    title: eventTitle(row, shipment),
    locationLabel: row.locationLabel,
    lat: row.lat,
    lng: row.lng,
    dateRange: dateRange(row),
    status: demoted ? "unknown" : row.status,
    confidence: demoted ? 0 : row.confidence,
    evidenceSummary: demoted
      ? "Integrity notice: the evidence supporting this step could not be loaded, so it is shown as unknown rather than asserted."
      : row.evidenceSummary,
    inferenceBasis: demoted ? null : row.inferenceBasis,
    lotCode: row.lotCode,
    illustrative: cards.some((c) => c.mock),
    evidence: demoted ? [] : cards,
  };
}

export async function serializeTrace(
  db: Db,
  traceId: string,
): Promise<TraceView | null> {
  const [trace] = await db
    .select()
    .from(traces)
    .where(eq(traces.id, traceId))
    .limit(1);
  if (!trace) return null;

  const productEvents = await db
    .select()
    .from(supplyChainEvents)
    .where(eq(supplyChainEvents.productId, trace.productId));
  const byId = new Map(productEvents.map((e) => [e.id, e]));

  const eventIds = productEvents.map((e) => e.id);
  const links: ClaimRow[] = eventIds.length
    ? await db
        .select()
        .from(claimEvidence)
        .where(inArray(claimEvidence.eventId, eventIds))
    : [];
  const evidenceIds = [...new Set(links.map((l) => l.evidenceId))];
  const evidenceRows: EvidenceRow[] = evidenceIds.length
    ? await db.select().from(evidence).where(inArray(evidence.id, evidenceIds))
    : [];
  const evidenceById = new Map(evidenceRows.map((e) => [e.id, e]));

  const shipmentIds = [
    ...new Set(
      productEvents
        .map((e) => e.shipmentId)
        .filter((v): v is string => v !== null),
    ),
  ];
  const shipmentRows: ShipmentRow[] = shipmentIds.length
    ? await db
        .select()
        .from(shipments)
        .where(inArray(shipments.id, shipmentIds))
    : [];
  const shipmentById = new Map(shipmentRows.map((s) => [s.id, s]));

  const cardsFor = (eventId: string): EvidenceCard[] =>
    links
      .filter((l) => l.eventId === eventId)
      .map((l) => {
        const row = evidenceById.get(l.evidenceId);
        return row ? toCard(row, l.relevance) : null;
      })
      .filter((c): c is EvidenceCard => c !== null)
      .sort((a, b) => (a.relevance === "primary" ? -1 : 1) - (b.relevance === "primary" ? -1 : 1));

  // Primary journey: bestPath order, plus (for batch traces) lot-scoped
  // events appended after the chain.
  const pathIds = trace.bestPath.filter((id) => byId.has(id));
  const lotEvents =
    trace.kind === "batch" && trace.lotCode
      ? productEvents.filter(
          (e) => e.lotCode === trace.lotCode && !pathIds.includes(e.id),
        )
      : [];
  const journeyRows = [
    ...pathIds.map((id) => byId.get(id)!),
    ...lotEvents,
  ];

  const events = journeyRows.map((row, i) =>
    toEvent(
      row,
      i + 1,
      cardsFor(row.id),
      row.shipmentId ? shipmentById.get(row.shipmentId) : undefined,
    ),
  );

  // Off-path recall notices (product-level).
  const recallRows = productEvents.filter(
    (e) =>
      e.eventType === "recall" &&
      !pathIds.includes(e.id) &&
      !lotEvents.some((l) => l.id === e.id),
  );
  const recalls = recallRows.map((row, i) =>
    toEvent(row, events.length + i + 1, cardsFor(row.id), undefined),
  );

  const counts: StatusCounts = {
    verified: 0,
    documented: 0,
    inferred: 0,
    unknown: 0,
  };
  for (const e of events) {
    if (e.status !== "observed") counts[e.status] += 1;
  }

  return {
    traceId: trace.id,
    gtin: "", // filled by the caller, which knows the product row
    kind: trace.kind,
    lotCode: trace.lotCode,
    serial: trace.serial,
    expiryDate: trace.expiryDate,
    state: trace.status,
    pipeline: trace.pipeline.map(({ key, label, state }) => ({
      key,
      label,
      state,
    })),
    events,
    recalls,
    counts,
    pathScore: trace.pathScore,
    engineVersion: trace.engineVersion,
    sourcesAsOf: trace.sourcesAsOf.toISOString(),
    computedAt: trace.computedAt?.toISOString() ?? null,
  };
}
