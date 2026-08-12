import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { evidence } from "./evidence";

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Canonical GTIN-14, zero-padded — the one key used everywhere. */
    gtin: varchar("gtin", { length: 14 }).notNull(),
    /** UPC-A as printed; also the FDC gtinUpc match key. Null for true EANs. */
    upc: varchar("upc", { length: 12 }),
    name: text("name").notNull(),
    brandId: uuid("brand_id").references(() => companies.id),
    manufacturerId: uuid("manufacturer_id").references(() => companies.id),
    category: text("category").notNull(), // "coffee" | "chocolate" | … (free text v1)
    imageUrl: text("image_url"),
    description: text("description"),
    ingredientsText: text("ingredients_text"),
    /**
     * The evidence row for the product identity itself (OFF/FDC/UPCitemdb
     * lookup). Identity is a claim too: nothing renders without it. This is
     * also where Open Food Facts' ODbL attribution obligation is carried
     * into the UI.
     */
    identityEvidenceId: uuid("identity_evidence_id")
      .notNull()
      .references(() => evidence.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("products_gtin_ux").on(t.gtin),
    index("products_upc_ix").on(t.upc),
    index("products_brand_ix").on(t.brandId),
  ],
);
