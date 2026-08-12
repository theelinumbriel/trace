import {
  pgTable,
  uuid,
  varchar,
  text,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { symbologyEnum } from "./enums";
import { products } from "./products";
import { traces } from "./traces";

/**
 * Scan events. Privacy invariant: precise coordinates never reach the
 * server — the client rounds to 2 decimals (~1.1 km) before POSTing and the
 * API's Zod schema re-rounds as defense in depth. Only the locality display
 * string ("Upper East Side, New York") is ever shown.
 */
export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gtin: varchar("gtin", { length: 14 }).notNull(),
    /** Null = scan that resolved to nothing (coverage signal). */
    productId: uuid("product_id").references(() => products.id),
    traceId: uuid("trace_id").references(() => traces.id),
    /** Decoded string incl. GS separators if DataMatrix. */
    rawValue: text("raw_value").notNull(),
    symbology: symbologyEnum("symbology").notNull(),
    /** Parsed GS1 AIs ({"10": "L2024-118"}), GsAiDataSchema-validated. */
    aiData: jsonb("ai_data"),
    lotCode: text("lot_code"), // convenience extraction of AI(10)
    locality: text("locality"), // display string ONLY
    approxLat: doublePrecision("approx_lat"),
    approxLng: doublePrecision("approx_lng"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scans_gtin_ix").on(t.gtin, t.createdAt)],
);
