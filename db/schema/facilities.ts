import {
  pgTable,
  uuid,
  text,
  char,
  doublePrecision,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { facilityTypeEnum } from "./enums";
import { companies } from "./companies";

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Natural key, e.g. "cor-mill-artois", "port-rotterdam". */
    slug: text("slug").notNull(),
    /** Nullable: ports and other shared infrastructure have no operator here. */
    companyId: uuid("company_id").references(() => companies.id),
    name: text("name").notNull(),
    facilityType: facilityTypeEnum("facility_type").notNull(),
    city: text("city"),
    region: text("region"),
    country: char("country", { length: 2 }).notNull(),
    // Plain numeric lat/lng: every v1 spatial need is display-only (markers +
    // client-side great-circle arcs). PostGIS is deliberately deferred until
    // the first SQL-side distance query exists.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Open Supply Hub OS ID when the facility was sourced there (CC BY-SA). */
    osId: varchar("os_id", { length: 20 }),
    /** UN/LOCODE for ports: "NLRTM", "USNYC". */
    unlocode: varchar("unlocode", { length: 5 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("facilities_slug_ux").on(t.slug),
    index("facilities_company_ix").on(t.companyId),
  ],
);
