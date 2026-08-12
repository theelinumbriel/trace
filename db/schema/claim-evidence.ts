import { pgTable, uuid, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { evidence } from "./evidence";
import { supplyChainEvents } from "./events";
import { shipments } from "./shipments";
import { productMaterials } from "./materials";

/**
 * Many-to-many claims↔evidence. A "claim" is exactly one of: a
 * supply_chain_event, a shipment (corroboration beyond source_evidence_id),
 * or a product_material origin assertion. Real FKs, no polymorphic strings —
 * the CHECK guarantees each row targets exactly one claim.
 */
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    eventId: uuid("event_id").references(() => supplyChainEvents.id, {
      onDelete: "cascade",
    }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, {
      onDelete: "cascade",
    }),
    productMaterialId: uuid("product_material_id").references(
      () => productMaterials.id,
      { onDelete: "cascade" },
    ),
    relevance: text("relevance").notNull().default("primary"), // "primary" | "corroborating"
  },
  (t) => [
    check(
      "claim_one_target_ck",
      sql`num_nonnulls(${t.eventId}, ${t.shipmentId}, ${t.productMaterialId}) = 1`,
    ),
    uniqueIndex("claim_evidence_event_ux")
      .on(t.evidenceId, t.eventId)
      .where(sql`${t.eventId} IS NOT NULL`),
  ],
);
