import {
  pgTable,
  uuid,
  text,
  char,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companyTypeEnum } from "./enums";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Natural key for seed upserts and dedupe, e.g. "tonys-chocolonely". */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /**
     * Diacritic-stripped, lowercased, trimmed name for alias matching
     * ("Oatly AB" vs "OATLY, Inc."). Computed in TS (lib/canonical.ts) so it
     * behaves identically on Neon and PGlite.
     */
    canonicalKey: text("canonical_key").notNull(),
    parentCompanyId: uuid("parent_company_id").references(
      (): AnyPgColumn => companies.id,
    ),
    website: text("website"),
    country: char("country", { length: 2 }), // ISO 3166-1 alpha-2
    companyType: companyTypeEnum("company_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("companies_slug_ux").on(t.slug)],
);
