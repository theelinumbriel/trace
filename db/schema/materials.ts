import {
  pgTable,
  uuid,
  text,
  char,
  smallint,
  varchar,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimStatusEnum } from "./enums";
import { products } from "./products";

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Natural key: "cocoa", "organic-cotton", "arabica-green-coffee". */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category"), // "agricultural" | "textile" | "water" | …
    hsCode: varchar("hs_code", { length: 10 }),
  },
  (t) => [uniqueIndex("materials_slug_ux").on(t.slug)],
);

/**
 * A product↔material link is itself an origin *claim* with status and
 * confidence — it cites evidence through claim_evidence like any other claim.
 */
export const productMaterials = pgTable(
  "product_materials",
  {
    // Surrogate PK so claim_evidence can FK it.
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    role: text("role").notNull().default("primary"), // "primary" | "packaging"
    originCountry: char("origin_country", { length: 2 }),
    originNote: text("origin_note"),
    status: claimStatusEnum("status").notNull().default("unknown"),
    confidence: smallint("confidence").notNull().default(0),
  },
  (t) => [
    uniqueIndex("product_materials_ux").on(t.productId, t.materialId, t.role),
    check("pm_confidence_ck", sql`${t.confidence} BETWEEN 0 AND 100`),
    check(
      "pm_unknown_zero_ck",
      sql`${t.status} <> 'unknown' OR ${t.confidence} = 0`,
    ),
  ],
);
