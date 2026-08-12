import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  date,
  smallint,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimStatusEnum, eventTypeEnum } from "./enums";
import { products } from "./products";
import { companies } from "./companies";
import { facilities } from "./facilities";
import { shipments } from "./shipments";

/**
 * A supply-chain stage claim. Insert-only. Written ONLY through
 * lib/engine/persist.ts, which refuses any non-unknown event without
 * evidence links.
 */
export const supplyChainEvents = pgTable(
  "supply_chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    eventType: eventTypeEnum("event_type").notNull(),
    companyId: uuid("company_id").references(() => companies.id),
    facilityId: uuid("facility_id").references(() => facilities.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    /** Large display name: "Landskrona, Sweden" / "Gothenburg → Newark". */
    locationLabel: text("location_label").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    status: claimStatusEnum("status").notNull(),
    confidence: smallint("confidence").notNull(), // 0–100
    /**
     * "Why we think this" — REQUIRED for every status. Unknown events carry
     * an explicit uncertainty statement here, e.g. "No public record
     * identifies the growing region for this SKU."
     */
    evidenceSummary: text("evidence_summary").notNull(),
    /** Required iff status = 'inferred': the stated basis of the inference. */
    inferenceBasis: text("inference_basis"),
    /** Registered engine rule that proposed this event ("infer:eu-us-ocean"). */
    ruleId: text("rule_id"),
    /** Non-null ⇒ batch-scoped event (lot-matched recall etc.). */
    lotCode: text("lot_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_product_ix").on(t.productId),
    check("events_confidence_ck", sql`${t.confidence} BETWEEN 0 AND 100`),
    check(
      "events_inference_ck",
      sql`${t.status} <> 'inferred' OR ${t.inferenceBasis} IS NOT NULL`,
    ),
    check(
      "events_unknown_ck",
      sql`${t.status} <> 'unknown' OR ${t.confidence} = 0`,
    ),
    // Status↔confidence bands, enforced in-row at the DB layer.
    check(
      "events_band_ck",
      sql`(${t.status} = 'verified' AND ${t.confidence} BETWEEN 85 AND 100) OR
          (${t.status} = 'documented' AND ${t.confidence} BETWEEN 70 AND 94) OR
          (${t.status} = 'inferred' AND ${t.confidence} BETWEEN 1 AND 84) OR
          (${t.status} = 'unknown' AND ${t.confidence} = 0)`,
    ),
  ],
);
