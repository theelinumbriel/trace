import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sourceTypeEnum } from "./enums";

/**
 * Immutable snapshots of what a source said. Insert-only: re-fetches insert
 * new rows (deduped by content hash); nothing ever mutates an evidence row.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Adapter that produced this row ("open-food-facts", "seed", …). */
    providerId: text("provider_id").notNull(),
    sourceName: text("source_name").notNull(), // "Open Food Facts", "Tony's Chocolonely"
    sourceUrl: text("source_url").notNull(), // REAL URL, always
    sourceType: sourceTypeEnum("source_type").notNull(),
    /** Document title shown on the evidence card. */
    title: text("title").notNull(),
    publisher: text("publisher"),
    publicationDate: date("publication_date"), // null when the source is undated
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    /** Verbatim excerpt that supports the claim(s) citing this row. */
    supportingText: text("supporting_text").notNull(),
    /** 0–100, deterministic per source type (see lib/confidence.ts). */
    reliabilityScore: smallint("reliability_score").notNull(),
    license: text("license"), // "ODbL", "CC0-1.0", "CC-BY-SA-4.0", …
    /** Full response snapshot for provider-fetched rows; null for curated docs. */
    raw: jsonb("raw"),
    /** sha256 of supportingText — dedupe key with sourceUrl. */
    contentHash: text("content_hash").notNull(),
    /** Build-time flag: URL confirmed to exist but excerpt needs a re-check. */
    needsVerification: boolean("needs_verification").notNull().default(false),
  },
  (t) => [
    index("evidence_url_ix").on(t.sourceUrl),
    uniqueIndex("evidence_dedupe_ux").on(t.sourceUrl, t.contentHash),
    check(
      "evidence_reliability_ck",
      sql`${t.reliabilityScore} BETWEEN 0 AND 100`,
    ),
  ],
);
