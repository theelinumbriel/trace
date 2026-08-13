import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  claimEvidence,
  evidence,
  supplyChainEvents,
} from "@/db/schema";

/**
 * THE write gate. This module is the ONLY place in the codebase allowed to
 * insert supply_chain_events, claim_evidence, or evidence rows — enforced by
 * a CI grep (see scripts/check-integrity-gate.sh) on top of the DB CHECK
 * constraints. LLM or provider output cannot reach the graph except through
 * these functions, which refuse sourceless claims.
 */

export class EvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(`Evidence integrity violation: ${message}`);
    this.name = "EvidenceIntegrityError";
  }
}

export type NewEvidence = {
  providerId: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: (typeof evidence.$inferInsert)["sourceType"];
  title: string;
  publisher?: string | null;
  publicationDate?: string | null;
  retrievedAt: Date;
  supportingText: string;
  reliabilityScore: number;
  license?: string | null;
  raw?: unknown;
  needsVerification?: boolean;
};

export function contentHash(supportingText: string): string {
  return createHash("sha256").update(supportingText, "utf8").digest("hex");
}

/**
 * Insert-only evidence persistence, deduped by (sourceUrl, contentHash).
 * Returns the id of the existing or newly inserted row.
 */
export async function persistEvidence(
  db: Db,
  input: NewEvidence,
): Promise<string> {
  const hash = contentHash(input.supportingText);
  const existing = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(eq(evidence.sourceUrl, input.sourceUrl), eq(evidence.contentHash, hash)),
    )
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const inserted = await db
    .insert(evidence)
    .values({
      providerId: input.providerId,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      title: input.title,
      publisher: input.publisher ?? null,
      publicationDate: input.publicationDate ?? null,
      retrievedAt: input.retrievedAt,
      supportingText: input.supportingText,
      reliabilityScore: input.reliabilityScore,
      license: input.license ?? null,
      raw: input.raw ?? null,
      contentHash: hash,
      needsVerification: input.needsVerification ?? false,
    })
    .onConflictDoNothing({
      target: [evidence.sourceUrl, evidence.contentHash],
    })
    .returning({ id: evidence.id });

  if (inserted.length > 0) return inserted[0].id;
  // Lost a race to a concurrent insert — read the winner.
  const winner = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(eq(evidence.sourceUrl, input.sourceUrl), eq(evidence.contentHash, hash)),
    )
    .limit(1);
  return winner[0].id;
}

export type NewEvent = Omit<
  typeof supplyChainEvents.$inferInsert,
  "id" | "createdAt"
>;

/**
 * Persist a supply-chain event claim with its evidence links, atomizing the
 * integrity rule:
 *   - status ≠ unknown  ⇒ at least one evidence id (refused otherwise)
 *   - status = unknown  ⇒ zero evidence ids and confidence 0 (a gap marker,
 *     never a sourced-looking guess)
 */
export async function persistEvent(
  db: Db,
  event: NewEvent,
  evidenceIds: string[],
  relevance: ("primary" | "corroborating")[] = [],
): Promise<string> {
  if (event.status !== "unknown" && evidenceIds.length === 0) {
    throw new EvidenceIntegrityError(
      `event "${event.locationLabel}" (${event.eventType}, ${event.status}) has no evidence`,
    );
  }
  if (event.status === "unknown" && evidenceIds.length > 0) {
    throw new EvidenceIntegrityError(
      `unknown event "${event.locationLabel}" must not carry evidence links — use a real status`,
    );
  }
  if (event.status === "unknown" && event.confidence !== 0) {
    throw new EvidenceIntegrityError(
      `unknown event "${event.locationLabel}" must have confidence 0`,
    );
  }

  const [row] = await db
    .insert(supplyChainEvents)
    .values(event)
    .returning({ id: supplyChainEvents.id });

  if (evidenceIds.length > 0) {
    await db.insert(claimEvidence).values(
      evidenceIds.map((evidenceId, i) => ({
        evidenceId,
        eventId: row.id,
        relevance: relevance[i] ?? (i === 0 ? "primary" : "corroborating"),
      })),
    );
  }
  return row.id;
}

/** Evidence links for a product_material origin claim. */
export async function linkMaterialEvidence(
  db: Db,
  productMaterialId: string,
  evidenceIds: string[],
): Promise<void> {
  if (evidenceIds.length === 0) return;
  await db.insert(claimEvidence).values(
    evidenceIds.map((evidenceId, i) => ({
      evidenceId,
      productMaterialId,
      relevance: i === 0 ? "primary" : "corroborating",
    })),
  );
}

/** Corroborating links for a shipment (beyond its NOT NULL source evidence). */
export async function linkShipmentEvidence(
  db: Db,
  shipmentId: string,
  evidenceIds: string[],
): Promise<void> {
  if (evidenceIds.length === 0) return;
  await db.insert(claimEvidence).values(
    evidenceIds.map((evidenceId) => ({
      evidenceId,
      shipmentId,
      relevance: "corroborating",
    })),
  );
}
