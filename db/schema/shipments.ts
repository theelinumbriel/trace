import {
  pgTable,
  uuid,
  date,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { transportModeEnum } from "./enums";
import { facilities } from "./facilities";
import { evidence } from "./evidence";

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    originFacilityId: uuid("origin_facility_id").references(
      () => facilities.id,
    ),
    destinationFacilityId: uuid("destination_facility_id").references(
      () => facilities.id,
    ),
    originPortId: uuid("origin_port_id").references(() => facilities.id),
    destinationPortId: uuid("destination_port_id").references(
      () => facilities.id,
    ),
    transportMode: transportModeEnum("transport_mode")
      .notNull()
      .default("unknown"),
    departedOn: date("departed_on"),
    arrivedOn: date("arrived_on"),
    hsCode: text("hs_code"),
    description: text("description"),
    /** HARD RULE: a shipment row cannot exist without evidence. */
    sourceEvidenceId: uuid("source_evidence_id")
      .notNull()
      .references(() => evidence.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("shipments_origin_ix").on(t.originFacilityId)],
);
