All research is complete — every UPC verified against a live database (Open Food Facts, USDA FDC, or UPCitemdb) during this session, and all evidence documents confirmed to exist. Here is the design document.

---

# Trace — Design: Database Schema + Seed Dataset (v1 vertical slice)

**Scope:** Drizzle schema, product/batch trace representation, migration + seed tooling, seed dataset (7 real products, UPCs live-verified 2026-08-12), and evidence-integrity rules.
**Stack assumptions (from verified research):** Next.js 16.3 App Router, Postgres on Neon (Vercel Marketplace), `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10`, `@neondatabase/serverless` via `drizzle-orm/neon-http` at runtime, `zod@4.4.3`, seeds run locally/CI with `tsx` over `drizzle-orm/node-postgres`.

---

## 0. File layout

```
drizzle.config.ts
drizzle/                          # generated SQL migrations (checked in)
src/db/
  index.ts                        # runtime client (neon-http)
  schema.ts                       # barrel: export * from './schema/…'
  schema/
    enums.ts
    companies.ts
    facilities.ts
    products.ts
    materials.ts
    shipments.ts
    events.ts
    evidence.ts
    traces.ts
    scans.ts
  json-types.ts                   # zod schemas for every JSONB column shape
  seed-schema.ts                  # zod schema for seed JSON files
  seed-data/
    counter-culture-big-trouble.json
    tonys-milk-32.json
    california-olive-ranch-100ca.json
    bobs-red-mill-rolled-oats.json
    oatly-original-64oz.json
    patagonia-p6-logo-tee.json
    great-value-purified-water.json
scripts/
  seed.ts                         # tsx entrypoint, transactional, idempotent
src/lib/gtin.ts                   # GTIN normalization (shared with scanner + API)
src/lib/trace/serialize.ts        # render-gate (integrity rule enforcement)
```

---

## 1. Drizzle schema

### 1.1 Enums (`src/db/schema/enums.ts`)

```ts
import { pgEnum } from "drizzle-orm/pg-core";

// The four spec statuses. "Observed" (the scan node) is NOT an enum value:
// the scan step is rendered from the `scans` table and labeled Observed in
// the UI — it is direct first-party observation, not a claim needing evidence.
export const claimStatusEnum = pgEnum("claim_status", [
  "verified",    // direct structured traceability OR ≥2 independent primary sources
  "documented",  // a primary document from the responsible party
  "inferred",    // derived from sourced evidence via a stated basis
  "unknown",     // first-class: no evidence; rendered with an uncertainty statement
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "product_database",        // Open Food Facts, UPCitemdb, FDC branded foods
  "manufacturer_disclosure", // brand's own site/pages/press releases
  "sustainability_report",   // annual/CSR/transparency reports
  "certification",           // Fairtrade, B Corp, organic certifier DBs
  "government_record",       // FDA/USDA non-recall records
  "recall_database",         // openFDA enforcement
  "customs_record",          // BoL indexes (ImportYeti/Panjiva public pages; mocked API)
  "gs1_registry",            // Verified by GS1 / GS1 US Company Database (manual, mocked API)
  "traceability_system",     // EPCIS / GS1 Digital Link resolvers
  "news_media",
  "retailer_listing",
  "other",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "material_origin", "processing", "manufacturing", "packaging",
  "export", "freight", "import", "distribution", "retail",
]);

export const transportModeEnum = pgEnum("transport_mode", [
  "ocean", "air", "rail", "truck", "multimodal", "unknown",
]);

export const facilityTypeEnum = pgEnum("facility_type", [
  "farm", "cooperative", "mill", "processing_plant", "factory", "roastery",
  "bottling_plant", "port", "warehouse", "distribution_center",
  "headquarters", "retail_store",
]);

export const companyTypeEnum = pgEnum("company_type", [
  "brand", "manufacturer", "co_packer", "supplier", "cooperative",
  "importer", "logistics", "retailer", "holding",
]);

export const traceKindEnum   = pgEnum("trace_kind",   ["product", "batch"]);
export const traceStatusEnum = pgEnum("trace_status", ["pending", "running", "complete", "partial", "failed"]);
export const symbologyEnum   = pgEnum("symbology",    ["upc_a", "ean_13", "ean_8", "data_matrix", "qr_code", "manual"]);
```

### 1.2 Core tables

```ts
// src/db/schema/companies.ts
import { pgTable, uuid, text, char, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companyTypeEnum } from "./enums";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),                 // seed/upsert natural key, e.g. "tonys-chocolonely"
  name: text("name").notNull(),
  parentCompanyId: uuid("parent_company_id").references((): AnyPgColumn => companies.id),
  website: text("website"),
  country: char("country", { length: 2 }),      // ISO 3166-1 alpha-2
  companyType: companyTypeEnum("company_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("companies_slug_ux").on(t.slug)]);
```

```ts
// src/db/schema/facilities.ts
import { pgTable, uuid, text, char, doublePrecision, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { facilityTypeEnum } from "./enums";
import { companies } from "./companies";

export const facilities = pgTable("facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),                 // "cor-mill-artois", "port-rotterdam"
  companyId: uuid("company_id").references(() => companies.id), // nullable: ports have none
  name: text("name").notNull(),
  facilityType: facilityTypeEnum("facility_type").notNull(),
  city: text("city"),
  region: text("region"),
  country: char("country", { length: 2 }).notNull(),
  lat: doublePrecision("lat"),                  // plain numeric — see §1.5
  lng: doublePrecision("lng"),
  osId: varchar("os_id", { length: 20 }),       // Open Supply Hub OS ID (CC-BY-SA source)
  unlocode: varchar("unlocode", { length: 5 }), // ports: "NLRTM", "USNYC"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("facilities_slug_ux").on(t.slug),
  index("facilities_company_ix").on(t.companyId),
]);
```

```ts
// src/db/schema/evidence.ts
import { pgTable, uuid, text, smallint, date, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sourceTypeEnum } from "./enums";

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceName: text("source_name").notNull(),      // "Open Food Facts", "Tony's Chocolonely"
  sourceUrl: text("source_url").notNull(),        // REAL URL, always
  sourceType: sourceTypeEnum("source_type").notNull(),
  title: text("title").notNull(),                 // document title shown on evidence card
  publisher: text("publisher"),
  publicationDate: date("publication_date"),      // null when undated
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  supportingText: text("supporting_text").notNull(), // the excerpt that supports the claim
  reliabilityScore: smallint("reliability_score").notNull(), // 0–100, deterministic (§5.4)
  license: text("license"),                       // "ODbL", "CC0-1.0", "CC-BY-SA-4.0", null
  needsVerification: boolean("needs_verification").notNull().default(false), // §4 build-time flag
}, (t) => [
  index("evidence_url_ix").on(t.sourceUrl),
  check("evidence_reliability_ck", sql`${t.reliabilityScore} BETWEEN 0 AND 100`),
]);
```

```ts
// src/db/schema/products.ts
import { pgTable, uuid, varchar, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { evidence } from "./evidence";

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  gtin: varchar("gtin", { length: 14 }).notNull(),   // canonical GTIN-14, zero-padded (§1.6)
  upc: varchar("upc", { length: 12 }),               // UPC-A as printed; also FDC gtinUpc match key
  name: text("name").notNull(),
  brandId: uuid("brand_id").references(() => companies.id),
  manufacturerId: uuid("manufacturer_id").references(() => companies.id),
  category: text("category").notNull(),              // "coffee" | "chocolate" | … (free text v1)
  imageUrl: text("image_url"),
  description: text("description"),
  // The evidence row for the product identity itself (OFF/FDC/UPCitemdb lookup).
  // Identity is a claim too: nothing renders without it (§5).
  identityEvidenceId: uuid("identity_evidence_id").notNull().references(() => evidence.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("products_gtin_ux").on(t.gtin),
  index("products_upc_ix").on(t.upc),
  index("products_brand_ix").on(t.brandId),
]);
```

```ts
// src/db/schema/materials.ts
import { pgTable, uuid, text, char, smallint, varchar, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimStatusEnum } from "./enums";
import { products } from "./products";

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),           // "cocoa", "organic-cotton", "arabica-green-coffee"
  name: text("name").notNull(),
  category: text("category"),             // "agricultural" | "textile" | "water" | …
  hsCode: varchar("hs_code", { length: 10 }),
}, (t) => [uniqueIndex("materials_slug_ux").on(t.slug)]);

export const productMaterials = pgTable("product_materials", {
  id: uuid("id").primaryKey().defaultRandom(),   // surrogate PK so claim_evidence can FK it
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  role: text("role").notNull().default("primary"),   // "primary" | "packaging"
  originCountry: char("origin_country", { length: 2 }),
  originNote: text("origin_note"),
  status: claimStatusEnum("status").notNull().default("unknown"),
  confidence: smallint("confidence").notNull().default(0),
}, (t) => [
  uniqueIndex("product_materials_ux").on(t.productId, t.materialId, t.role),
  check("pm_confidence_ck", sql`${t.confidence} BETWEEN 0 AND 100`),
  check("pm_unknown_zero_ck", sql`${t.status} <> 'unknown' OR ${t.confidence} = 0`),
]);
```

```ts
// src/db/schema/shipments.ts
import { pgTable, uuid, date, text, timestamp, index } from "drizzle-orm/pg-core";
import { transportModeEnum } from "./enums";
import { facilities } from "./facilities";
import { evidence } from "./evidence";

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  originFacilityId: uuid("origin_facility_id").references(() => facilities.id),
  destinationFacilityId: uuid("destination_facility_id").references(() => facilities.id),
  originPortId: uuid("origin_port_id").references(() => facilities.id),
  destinationPortId: uuid("destination_port_id").references(() => facilities.id),
  transportMode: transportModeEnum("transport_mode").notNull().default("unknown"),
  departedOn: date("departed_on"),
  arrivedOn: date("arrived_on"),
  description: text("description"),
  // HARD RULE: a shipment row cannot exist without evidence. NOT NULL FK.
  sourceEvidenceId: uuid("source_evidence_id").notNull().references(() => evidence.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("shipments_origin_ix").on(t.originFacilityId)]);
```

```ts
// src/db/schema/events.ts
import { pgTable, uuid, text, doublePrecision, date, smallint, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimStatusEnum, eventTypeEnum } from "./enums";
import { products } from "./products";
import { companies } from "./companies";
import { facilities } from "./facilities";
import { shipments } from "./shipments";

export const supplyChainEvents = pgTable("supply_chain_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  eventType: eventTypeEnum("event_type").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  facilityId: uuid("facility_id").references(() => facilities.id),
  shipmentId: uuid("shipment_id").references(() => shipments.id),
  locationLabel: text("location_label").notNull(),   // "Landskrona, Sweden" — large display name
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  startedOn: date("started_on"),
  endedOn: date("ended_on"),
  status: claimStatusEnum("status").notNull(),
  confidence: smallint("confidence").notNull(),      // 0–100
  // "Why we think this" — REQUIRED for every status, including unknown
  // (unknown gets an explicit uncertainty statement, e.g. "No public record identifies …").
  evidenceSummary: text("evidence_summary").notNull(),
  inferenceBasis: text("inference_basis"),           // required iff status = 'inferred'
  lotCode: text("lot_code"),                         // non-null ⇒ batch-scoped event (§2)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("events_product_ix").on(t.productId),
  check("events_confidence_ck", sql`${t.confidence} BETWEEN 0 AND 100`),
  check("events_inference_ck", sql`${t.status} <> 'inferred' OR ${t.inferenceBasis} IS NOT NULL`),
  check("events_unknown_ck", sql`${t.status} <> 'unknown' OR ${t.confidence} = 0`),
  // Confidence bands are status-constrained at the DB layer (§5.4):
  check("events_band_ck", sql`
    (${t.status} = 'verified'   AND ${t.confidence} BETWEEN 85 AND 100) OR
    (${t.status} = 'documented' AND ${t.confidence} BETWEEN 70 AND 94)  OR
    (${t.status} = 'inferred'   AND ${t.confidence} BETWEEN 1  AND 84)  OR
    (${t.status} = 'unknown'    AND ${t.confidence} = 0)`),
]);
```

```ts
// src/db/schema/claim-evidence.ts  (exported from evidence.ts or its own file)
import { pgTable, uuid, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { evidence } from "./evidence";
import { supplyChainEvents } from "./events";
import { shipments } from "./shipments";
import { productMaterials } from "./materials";

// Many-to-many claims<->evidence. A "claim" is exactly one of:
// a supply_chain_event, a shipment (extra corroboration beyond source_evidence_id),
// or a product_material origin assertion. Real FKs, no polymorphic string columns.
export const claimEvidence = pgTable("claim_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  eventId: uuid("event_id").references(() => supplyChainEvents.id, { onDelete: "cascade" }),
  shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "cascade" }),
  productMaterialId: uuid("product_material_id").references(() => productMaterials.id, { onDelete: "cascade" }),
  relevance: text("relevance").notNull().default("primary"), // "primary" | "corroborating"
}, (t) => [
  check("claim_one_target_ck",
    sql`num_nonnulls(${t.eventId}, ${t.shipmentId}, ${t.productMaterialId}) = 1`),
  uniqueIndex("claim_evidence_event_ux").on(t.evidenceId, t.eventId)
    .where(sql`${t.eventId} IS NOT NULL`),
]);
```

### 1.3 Persisted traces (`src/db/schema/traces.ts`)

```ts
import { pgTable, uuid, text, date, real, jsonb, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { traceKindEnum, traceStatusEnum } from "./enums";
import { products } from "./products";
import type { TracePipeline, RankedPath } from "../json-types";

export const traces = pgTable("traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: traceKindEnum("kind").notNull().default("product"),
  lotCode: text("lot_code"),                       // AI(10)
  serial: text("serial"),                          // AI(21)
  expiryDate: date("expiry_date"),                 // AI(17) — observed from the code, not a claim
  status: traceStatusEnum("status").notNull().default("pending"),
  pipeline: jsonb("pipeline").$type<TracePipeline>().notNull(),      // live checklist (§3.4)
  bestPath: jsonb("best_path").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
                                                   // ordered supply_chain_events.id[]
  altPaths: jsonb("alt_paths").$type<RankedPath[]>().notNull().default(sql`'[]'::jsonb`),
  pathScore: real("path_score"),                   // 0–100, best path aggregate
  engineVersion: text("engine_version").notNull(), // "seed-1" | "recon-0.1.0" — determinism marker
  sourcesAsOf: timestamp("sources_as_of", { withTimezone: true }).notNull(), // cache freshness
  computedAt: timestamp("computed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("traces_batch_id_ck",
    sql`${t.kind} = 'product' OR ${t.lotCode} IS NOT NULL OR ${t.serial} IS NOT NULL`),
  // one canonical product-level trace per product:
  uniqueIndex("traces_product_ux").on(t.productId).where(sql`${t.kind} = 'product'`),
  // one batch trace per (product, lot, serial); NULLS NOT DISTINCT so lot-only keys dedupe:
  uniqueIndex("traces_batch_ux").on(t.productId, t.lotCode, t.serial)
    .where(sql`${t.kind} = 'batch'`),
]);
```

JSONB shapes are Zod-owned in `src/db/json-types.ts` (validated on every write and on read in the serializer — JSONB is never trusted raw):

```ts
import { z } from "zod";

export const RankedPathSchema = z.object({
  eventIds: z.array(z.uuid()).min(1),
  score: z.number().min(0).max(100),
  label: z.string().optional(),                 // "Alternate: air freight"
});
export type RankedPath = z.infer<typeof RankedPathSchema>;

export const PipelineStepKey = z.enum([
  "identify", "brand", "facilities", "origins", "trade", "route",
]);
export const TracePipelineSchema = z.array(z.object({
  key: PipelineStepKey,
  label: z.string(),                            // "Searching trade records"
  state: z.enum(["pending", "active", "done", "failed", "skipped"]),
  finishedAt: z.iso.datetime().optional(),
}));
export type TracePipeline = z.infer<typeof TracePipelineSchema>;

export const GsAiDataSchema = z.record(z.string().regex(/^\d{2,4}$/), z.string()); // {"10":"L2024-118"}
```

### 1.4 Scans (`src/db/schema/scans.ts`)

```ts
import { pgTable, uuid, varchar, text, doublePrecision, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { symbologyEnum } from "./enums";
import { products } from "./products";
import { traces } from "./traces";

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  gtin: varchar("gtin", { length: 14 }).notNull(),
  productId: uuid("product_id").references(() => products.id),   // null = unresolved scan
  traceId: uuid("trace_id").references(() => traces.id),
  rawValue: text("raw_value").notNull(),        // decoded string incl. GS separators if DataMatrix
  symbology: symbologyEnum("symbology").notNull(),
  aiData: jsonb("ai_data"),                     // GsAiDataSchema-validated parsed AIs, or null
  lotCode: text("lot_code"),                    // convenience extraction of AI(10)
  locality: text("locality"),                   // "Upper East Side, New York" — display string ONLY
  approxLat: doublePrecision("approx_lat"),     // client-rounded to 2 decimals (~1.1 km) BEFORE send
  approxLng: doublePrecision("approx_lng"),     // server re-rounds in zod .transform() as defense
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("scans_gtin_ix").on(t.gtin, t.createdAt)]);
```

Privacy invariant: precise coordinates never reach the server. The client rounds to 2 decimals before calling BigDataCloud's client-side reverse-geocoder and before POSTing; the Route Handler's Zod schema applies `.transform(v => Math.round(v * 100) / 100)` again so a misbehaving client cannot persist precision.

### 1.5 Why plain `double precision` lat/lng, not PostGIS (deferred)

Every v1 spatial need is **display-only**: plot facility/port/scan markers and draw great-circle arcs (computed client-side with `@turf/great-circle`). There are zero spatial *queries* — no radius search, no nearest-facility, no geofencing, no joins on geometry. PostGIS would buy nothing while costing: a `CREATE EXTENSION` step outside drizzle-kit's migration diffing, awkward custom-type handling in Drizzle (its PostGIS support is limited to `geometry(point)` and is the least-mature corner of the kit), and a heavier local-dev story. Scan coordinates are deliberately ~1 km fuzzed anyway, which makes precise geography pointless. **Trigger to revisit:** the first feature that filters or sorts by distance in SQL ("scans near me", "closest facility"); then add PostGIS via a hand-written migration (`CREATE EXTENSION postgis;` — available on Neon free tier) and a `geography(Point,4326)` column populated from lat/lng.

### 1.6 GTIN normalization (`src/lib/gtin.ts`)

One canonical key everywhere: **GTIN-14, zero-padded**.

```ts
export type NormalizedGtin = {
  gtin14: string;          // "00858010005580" — products.gtin, route param, cache key
  upc12: string | null;    // "858010005580" — FDC gtinUpc match; null for true EAN-13/8
  input: string;
};
export function normalizeGtin(raw: string): NormalizedGtin | null;
// - strip non-digits; accept lengths 8/12/13/14; validate GS1 mod-10 check digit (reject invalid)
// - UPC-A(12) → "00"+code; EAN-13 → "0"+code; EAN-8 → "000000"+code; GTIN-14 as-is
// - upc12: gtin14.startsWith("00") ? gtin14.slice(2) : null
```

`/product/[gtin]` always redirects/canonicalizes to the GTIN-14 form. FDC lookups use `upc12` (verified live: FDC stores 12-digit `gtinUpc`, e.g. `039978001542`); OFF accepts either (verified live with 13-digit zero-padded forms).

---

## 2. PRODUCT TRACE vs BATCH TRACE representation

Representation is **one table** (`traces`) discriminated by `kind`, plus lot-scoped events:

1. **Decision is made at scan-parse time, never later.**
   - `upc_a` / `ean_13` / `ean_8` / `manual` → GTIN only → `kind: "product"`.
   - `data_matrix` / `qr_code` → parse raw value: if it's a GS1 Digital Link URI, extract AIs with `digital-link.js@1.4.3`; else parse the element string with `@valentynb/gs1-parser@2.0.0` (ZXing-C++ preserves the GS/0x1D separators — a decode-path test with a real `(17)(10)` code is a build-time acceptance item).
   - **`kind: "batch"` iff AI(10) lot or AI(21) serial is present.** AI(01) alone (a plain GTIN in a QR code) is still a product trace. Enforced by the `traces_batch_id_ck` CHECK.
2. **A batch trace never fabricates item-level provenance.** It is composed at serialization time as: the product-level `bestPath` events (each keeping its type-level status/confidence) **plus** any `supply_chain_events` rows where `lotCode` matches the trace's lot — v1's only generator of lot-scoped events is the openFDA recall adapter (lot matched against `code_info`/`product_description` text). AI(17) expiry is stored on the trace and displayed as *observed from the code you scanned* (like the scan node), not as a supply-chain claim.
3. **UI labeling** reads `trace.kind` directly: `PRODUCT TRACE — type-level, best-supported chain` vs `BATCH TRACE — lot ${lotCode}`. When a batch trace has zero lot-scoped events, the header states it explicitly: "No lot-specific records found; showing the product-level chain."
4. Uniqueness: one canonical product trace per product (partial unique index); batch traces keyed `(productId, lotCode, serial)`.

---

## 3. Migration + seed tooling

### 3.1 Config and scripts

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```jsonc
// package.json (scripts)
{
  "db:generate": "drizzle-kit generate",          // SQL migration from schema diff → ./drizzle
  "db:migrate":  "drizzle-kit migrate",           // apply committed migrations
  "db:push":     "drizzle-kit push",              // prototyping only, never CI/prod
  "db:seed":     "tsx --env-file=.env scripts/seed.ts",
  "db:reset":    "tsx --env-file=.env scripts/seed.ts --reset"
}
```

Runtime client (`src/db/index.ts`) uses `drizzle-orm/neon-http` + `@neondatabase/serverless`. The **seed script** instead uses `drizzle-orm/node-postgres` with `pg` — it runs from a laptop/CI where TCP is fine, and it needs a real transaction (neon-http has no interactive transactions). One `BEGIN … COMMIT` wraps the entire seed; any integrity failure rolls back everything.

### 3.2 Seed file format — same evidence model as live data

One JSON file per product in `src/db/seed-data/`, validated by `SeedFileSchema` (`src/db/seed-schema.ts`). Local string keys (`"e-fair-report"`) are resolved to UUIDs at insert; the loader is the only place keys exist.

```ts
// src/db/seed-schema.ts — signatures (zod 4)
const SeedEvidence = z.object({
  key: z.string(), sourceName: z.string(), sourceUrl: z.url(),
  sourceType: z.enum(sourceTypeEnum.enumValues),
  title: z.string(), publisher: z.string().optional(),
  publicationDate: z.iso.date().optional(),
  supportingText: z.string().min(20),          // forces a real excerpt, not a stub
  reliabilityScore: z.int().min(0).max(100),
  license: z.string().optional(),
  needsVerification: z.boolean().default(false),
});

const SeedEvent = z.object({
  key: z.string(),
  eventType: z.enum(eventTypeEnum.enumValues),
  companyKey: z.string().optional(), facilityKey: z.string().optional(),
  shipmentKey: z.string().optional(),
  locationLabel: z.string(),
  lat: z.number().optional(), lng: z.number().optional(),
  startedOn: z.iso.date().optional(), endedOn: z.iso.date().optional(),
  status: z.enum(claimStatusEnum.enumValues),
  confidence: z.int().min(0).max(100),
  evidenceSummary: z.string().min(20),
  inferenceBasis: z.string().optional(),
  evidence: z.array(z.string()),               // SeedEvidence keys
}).superRefine((e, ctx) => {
  // THE integrity rules, encoded in the format itself (§5):
  if (e.status !== "unknown" && e.evidence.length === 0)
    ctx.addIssue({ code: "custom", message: `${e.key}: non-unknown event requires >=1 evidence ref` });
  if (e.status === "unknown" && e.confidence !== 0)
    ctx.addIssue({ code: "custom", message: `${e.key}: unknown must have confidence 0` });
  if (e.status === "inferred" && !e.inferenceBasis)
    ctx.addIssue({ code: "custom", message: `${e.key}: inferred requires inferenceBasis` });
  // band checks mirror events_band_ck …
});

export const SeedFileSchema = z.object({
  product: z.object({
    gtin: z.string().regex(/^\d{14}$/), upc: z.string().regex(/^\d{12}$/).optional(),
    upcVerification: z.enum(["verified", "needs-verification"]),
    name: z.string(), category: z.string(),
    brandKey: z.string(), manufacturerKey: z.string().optional(),
    imageUrl: z.url().optional(), description: z.string().optional(),
    identityEvidenceKey: z.string(),
  }),
  companies: z.array(SeedCompany), facilities: z.array(SeedFacility),
  materials: z.array(SeedMaterial).default([]),
  productMaterials: z.array(SeedProductMaterial).default([]),
  shipments: z.array(SeedShipment).default([]),   // each REQUIRES sourceEvidenceKey
  evidence: z.array(SeedEvidence).min(1),
  events: z.array(SeedEvent).min(1),
  bestPath: z.array(z.string()).min(1),           // ordered event keys
  altPaths: z.array(z.object({ eventKeys: z.array(z.string()), score: z.number(), label: z.string().optional() })).default([]),
});
```

### 3.3 Loader algorithm (`scripts/seed.ts`)

```
1. glob src/db/seed-data/*.json → parse each with SeedFileSchema; ANY failure aborts before touching the DB.
2. BEGIN transaction. (--reset: TRUNCATE all trace tables CASCADE first.)
3. Per file, in dependency order, all upserts on natural keys (idempotent re-runs):
   companies (slug) → facilities (slug) → evidence (source_url + sha256(supporting_text))
   → materials (slug) → product (gtin, onConflictDoUpdate)
   → shipments (resolving evidenceKey → id; unknown key = throw)
   → product_materials + their claim_evidence
   → supply_chain_events + claim_evidence rows for every evidence ref
   → traces upsert (productId, kind='product'): status 'complete',
     pipeline = all six steps 'done', bestPath = resolved event ids,
     engineVersion 'seed-1', sourcesAsOf = max(evidence.retrievedAt), pathScore = min(confidence of non-unknown path events).
4. Post-insert SQL assertions (fail ⇒ ROLLBACK, nonzero exit):
   a. SELECT e.id FROM supply_chain_events e WHERE e.status <> 'unknown'
      AND NOT EXISTS (SELECT 1 FROM claim_evidence ce WHERE ce.event_id = e.id);      -- must be empty
   b. every traces.best_path element resolves to an event of the same product;
   c. every evidence.source_url parses as http(s) URL; count(needs_verification) reported to stdout.
5. COMMIT. Print per-product summary table (events by status, evidence count).
```

Because seeds land in the *same* tables with a normal `traces` row (only `engineVersion: "seed-1"` marks provenance), the product page, evidence drawer, map, and Sources tab cannot tell a seeded product from a live-reconstructed one — which is the point: one render path, one integrity gate.

### 3.4 Trace pipeline JSONB and progressive UI

The reconstruction engine updates `traces.pipeline` step-by-step (`identify → brand → facilities → origins → trade → route`) and `traces.status` transitions `pending → running → complete|partial|failed`. The progressive checklist UI polls `/api/products/[gtin]/trace` (or consumes its stream) and renders the pipeline array directly — seeded traces are born `complete` so they render instantly, which also exercises the "cached trace" fast path demanded by the caching spec.

---

## 4. Seed dataset — 7 real products (all UPCs live-verified 2026-08-12)

Verification methods used *today*: **OFF** = `GET world.openfoodfacts.org/api/v3/product/{gtin14}` returned `product_found`; **FDC** = USDA FoodData Central `/foods/search` returned the exact `gtinUpc` + `brandOwner`; **UPCitemdb** = trial lookup returned the item. No UPC below is invented; one product carries a build-time re-verification flag on an evidence URL (not on its UPC).

| # | Product (category) | UPC-A / GTIN-14 | Verified via | Trace texture |
|---|---|---|---|---|
| 1 | Counter Culture **Big Trouble** whole bean 12 oz (coffee) | `663505002063` / `00663505002063` | OFF (brand "Counter Culture Coffee") | Documented origin program + Documented roastery, Inferred import |
| 2 | **Tony's Chocolonely** Milk Chocolate 32%, 6.35 oz (chocolate) | `858010005580` / `00858010005580` | OFF (brand + `manufacturing_places: Belgium`) | Richest chain: Documented coops → Documented factory → Inferred ocean leg w/ real customs-index cites |
| 3 | **California Olive Ranch** 100% California EVOO 16.9 fl oz (olive oil) | `850687110505` / `00850687110505` | OFF (`origins: United States`, `manufacturing_places: California`) | All-domestic chain, mostly Documented — contrast case |
| 4 | **Bob's Red Mill** Old Fashioned Rolled Oats 16 oz (packaged food) | `039978001542` / `00039978001542` | FDC (`brandOwner: "Bob's Red Mill Natural Foods, Inc."`) | Documented mill, **Unknown crop origin** front and center |
| 5 | **Oatly** The Original Oatmilk 64 fl oz (beverage) | `190646641016` / `00190646641016` | OFF (brand "Oatly") | Documented facts that still leave "which of 3 plants" honestly unresolved |
| 6 | **Patagonia** Men's P-6 Logo Organic Cotton T-Shirt, XL Blue (clothing) | `888336749295` / `00888336749295` | UPCitemdb trial lookup | Clothing GTINs are per-style/size/color (README note); **Unknown factory** with documented candidate set |
| 7 | **Great Value** Purified Drinking Water (sparse demo) | `078742351926` / `00078742351926` | OFF ("Purified Drinking Water", brand Great Value) | Deliberately sparse: 2 Unknown stages, 1 Documented, scan |

### 4.1 Per-product evidence and stage plan

**1 — Counter Culture Big Trouble** (`counter-culture-big-trouble.json`)

Evidence rows (all URLs confirmed to exist today):
- OFF product record — `https://world.openfoodfacts.org/product/0663505002063` — `product_database`, license ODbL → supports identity.
- *Transparency Report 2025* — `https://counterculturecoffee.com/pages/transparency-report-2025` — `sustainability_report` (they've published annually since 2009; index at `https://counterculturecoffee.com/sustainability/reports`) → supports sourcing program, FOB prices, origin countries.
- Durham roastery/HQ, 812 Mallard Ave — `https://counterculturecoffee.com/learn/training-centers/durham-training-center` + Tasting Table profile `https://www.tastingtable.com/691861/counter-culture-coffee-durham-nc-new-training-center/` — `manufacturer_disclosure` + `news_media` → supports roasting location (their Durham roastery handles the large majority of production).
- Big Trouble product page — `https://counterculturecoffee.com/products/big-trouble` — flag `needsVerification: true` for the exact current blend-component origins (blends rotate seasonally).

Journey: 01 Green coffee — Latin American blend components (**Documented 74**, uncertainty note: "components rotate; farms not identified at type level") → 02 Import to US (**Inferred 62** — basis: coffee is not grown in the continental US; roasting occurs in Durham, NC; therefore green coffee was imported. Port **Unknown** — stated) → 03 Roasting, Durham NC (**Documented 90**) → 04 Retail distribution (**Inferred 55**, retailer listings as evidence) → 05 Scan (Observed).

**2 — Tony's Chocolonely Milk 32%** (`tonys-milk-32.json`)

- OFF record `https://world.openfoodfacts.org/product/0858010005580` (identity; `manufacturing_places: Belgium` as corroboration) — ODbL.
- *Annual FAIR Report 2024/25* — `https://tonyschocolonely.com/pages/annual-fair-report-2024-2025` — `sustainability_report` → supports cocoa sourced from partner cooperatives in Ghana & Côte d'Ivoire (19 coops per the 2024/25 report), Open Chain model.
- Barry Callebaut partnership announcement — `https://www.barry-callebaut.com/en/about-us/media/news-stories/barry-callebaut-and-tonys-chocolonely-sign-strategic-partnership-agreement` — `manufacturer_disclosure` → supports production on a dedicated line at Barry Callebaut's Wieze, Belgium factory with traceable cocoa liquor/butter.
- Invest in Flanders article — `https://invest.flandersinvestmentandtrade.com/en/news/tonys-chocolonely-nl-invests-millions-factory-flanders` — `news_media` → corroborates Belgian production.
- ImportYeti supplier page — `https://www.importyeti.com/supplier/tony-s-chocolonely` — `customs_record` → publicly indexes 130+ US ocean shipments; Panjiva's public page (`https://panjiva.com/Tony-s-Chocolonely-Inc/129294241`) additionally shows Rotterdam → New York/Newark shipments to consignee Tony's Chocolonely Inc. **Cite-only**: these evidence rows link the public pages; the mocked `TradeDataProvider` models the record shape (shipper, consignee, ports, date, weight) without scraping.

Journey: 01 Cocoa — partner co-ops, Ghana & Côte d'Ivoire (**Documented 90**) → 02 Chocolate production — Wieze, Belgium (**Documented 88**) → 03 Ocean freight Rotterdam → Port of NY/NJ, Newark (**Inferred 78**; basis: made-in-Belgium label + publicly indexed BoL summaries showing this exact lane; full records are behind commercial paywalls, so not Documented) — `shipments` row with port facilities `NLRTM`/`USNYC`, `sourceEvidenceId` = ImportYeti evidence → 04 US import & distribution — Tony's Chocolonely Inc. (consignee per public index) (**Inferred 64**) → 05 Scan. This intentionally reproduces the spec's example shape (Verified/Documented → Inferred 78 → Inferred 64 → scan).

**3 — California Olive Ranch 100% California EVOO** (`california-olive-ranch-100ca.json`)

- OFF record `https://world.openfoodfacts.org/product/0850687110505` (identity + `origins: United States`).
- 100% California line pages — `https://www.californiaoliveranch.com/collections/california-olive-ranch-100-california` and `https://www.californiaoliveranch.com/products/100-california-everyday` — `manufacturer_disclosure` → supports "olives grown exclusively in California" for this line (their other "Global Blend" line is explicitly imported — nice labeling contrast to note in `description`).
- Our Story — `https://www.californiaoliveranch.com/our-story` → supports ranch locations (Oroville/Artois/Corning area, ~60 mi north of Sacramento) + contract growers.
- Farm Progress on the Artois mill — `https://www.farmprogress.com/farm-business/artois-calif-destined-to-be-u-s-olive-oil-capital` — `news_media` → corroborates milling at Artois, CA.

Journey: 01 Olives — Northern California ranches + contract growers (**Documented 88**) → 02 Milling & bottling — Artois, CA (**Documented 85**) → 03 US distribution (**Inferred 58**; basis: national grocery listings) → 04 Scan. Zero import legs — demonstrates the engine doesn't hallucinate ports when a chain is domestic.

**4 — Bob's Red Mill Rolled Oats 16 oz** (`bobs-red-mill-rolled-oats.json`)

- FDC branded record — sourceUrl `https://fdc.nal.usda.gov/` with `supportingText` quoting the live-verified record (`gtinUpc: 039978001542`, `brandOwner: "Bob's Red Mill Natural Foods, Inc."`) — `government_record`, license CC0-1.0. Flag `needsVerification: true` to pin the exact `fdc-app.html#/food-details/{fdcId}` permalink at build time.
- Wikipedia — `https://en.wikipedia.org/wiki/Bob%27s_Red_Mill` — `other` → supports Milwaukie, Oregon milling/HQ (320k+ sq ft facility).
- Oats catalog page — `https://www.bobsredmill.com/products/oats` — `manufacturer_disclosure` → supports stone-milling process claims.

Journey: 01 Oats grown — **Unknown 0** ("Bob's Red Mill does not publicly disclose growing regions for this SKU. We will not guess.") → 02 Milling & packaging — Milwaukie, OR (**Documented 87**) → 03 Distribution — **Unknown 0** → 04 Scan. This is the mid-density product: a famous brand whose chain is still mostly dark — sparse-accurate over rich-fictional.

**5 — Oatly Original 64 oz** (`oatly-original-64oz.json`)

- OFF record `https://world.openfoodfacts.org/product/0190646641016` (identity).
- *Oatly Sustainability Update 2024* — `https://a.storyblok.com/f/107921/x/cbdb92c917/oatly-sustainability-update-2024.pdf` (+ 2025 report via `https://investors.oatly.com`) — `sustainability_report` → supports North American oat sourcing for NA production.
- Fort Worth facility press release — `https://investors.oatly.com/news-releases/news-release-details/fort-worth-chamber-commerce-welcomes-oatly-town` and NA renewable-electricity release (lists Millville NJ + Ogden UT) `https://investors.oatly.com/news-releases/news-release-details/oatly-transitions-north-america-production-facilities-100` — `manufacturer_disclosure` → supports the set of three NA plants.
- Manufacturing Dive on the Ya Ya Foods deal — `https://www.manufacturingdive.com/news/oatly-ya-ya-foods-american-partnership/639537/` — `news_media` → supports that the Ogden and Fort Worth plants are now operated by co-packer Ya Ya Foods (companies: Oatly Group AB → brand; Ya Ya Foods → `co_packer`).

Journey: 01 Oats — North America (**Documented 80**) → 02 Production — *one of three disclosed NA facilities: Millville NJ / Ogden UT / Fort Worth TX* (**Documented 75**, explicit uncertainty: "the specific plant is printed as a batch code on the carton — scan the DataMatrix if present; not identifiable at type level") → 03 Distribution (**Inferred 52**, retailer listings) → 04 Scan. Facility rows exist for all three plants; the event links none (`facilityId` null, candidates named in `evidenceSummary`) — modeling "documented candidate set, unresolved instance."

**6 — Patagonia P-6 Logo Organic Cotton Tee (M, XL, Blue)** (`patagonia-p6-logo-tee.json`)

- UPCitemdb record — `https://www.upcitemdb.com/upc/888336749295` — `product_database` → supports identity (title/brand verified via trial API today). README note: apparel GTINs are per style-size-color, so any P-6 tee variant scans to a *different* GTIN; the trace is shared at the style level via `description`.
- Patagonia *Factories, Farms and Material Suppliers* — `https://www.patagonia.com/factories-farms-material-suppliers/` — `manufacturer_disclosure`, **`needsVerification: true`** (patagonia.com was serving an outage/anti-bot page to automated fetches on 2026-08-12; the URL is confirmed via search index — re-verify by hand at build time).
- Open Supply Hub download (Patagonia-contributed facility list) — `https://opensupplyhub.org` — `other`, license CC-BY-SA-4.0 → the stable, structured copy of the factory list; the seed's facility candidate mention cites this.
- Historic finished-goods supplier list XLSX — `https://eu.patagonia.com/on/demandware.static/-/Library-Sites-PatagoniaShared/default/dw55edb3c8/PDF-EU/Patagonia-Finished-Goods-Supplier-List-May-2020.xlsx` — `manufacturer_disclosure`, publicationDate 2020-05, low reliabilityScore (staleness is expressed in the score, not hidden).

Journey: 01 Organic cotton — program-level sourcing (**Documented 70**, uncertainty: "countries not disclosed per product") → 02 Cut & sew — **Unknown 0** ("Patagonia discloses its factory list but does not map products to factories publicly; identifying the factory would require the style's Footprint data or item-level traceability") → 03 Import to US (**Inferred 56**; basis: Patagonia's disclosed finished-goods factories are predominantly outside the US) → 04 Scan. The clothing category's honest answer is mostly Unknown — by design.

**7 — Great Value Purified Drinking Water** (`great-value-purified-water.json`) — the deliberately sparse product

- OFF record `https://world.openfoodfacts.org/product/0078742351926` (identity: "Purified Drinking Water", brand Great Value) — ODbL.
- Walmart brand-ownership evidence — FDC shows `brandOwner: "Wal-Mart Stores, Inc."` across the `078742` prefix (live-verified on sibling GTINs today); additionally a **manual** GS1 US Company Database lookup (free web UI, 30 searches/day — no API, per verified research) of prefix `0078742` at build time produces a `gs1_registry` evidence row. This is exactly how the mocked GS1 adapter's fixture data is legally hand-seeded.

Journey: 01 Water source — **Unknown 0** ("Private-label water; the source is printed per-bottle by the bottling plant and varies. Not determinable at type level.") → 02 Bottling — **Unknown 0** ("Walmart does not disclose the co-packer for this UPC.") → 03 Brand ownership & distribution — Walmart Inc., Bentonville AR (**Documented 82**) → 04 Scan. Two of three stages Unknown: the homepage's example-traces row should include this one to set expectations.

### 4.2 Batch-trace demo (no fabrication)

None of the seven carry GS1 DataMatrix at retail. The README ships one **synthetic, clearly-labeled** GS1 element string `(01)00858010005580(10)TRACE-DEMO(17)270601` rendered as a DataMatrix image for testing `kind: "batch"`. The resulting batch trace is honest by construction: header "BATCH TRACE — lot TRACE-DEMO", the product-level Tony's chain, the openFDA recall check pipeline step run against the lot (finding nothing), and an explicit "No lot-specific records found" statement. No lot-level provenance is ever synthesized.

---

## 5. Evidence-integrity rules (non-negotiable, enforced in four layers)

**Rule statement:** *No supply-chain stage, shipment, material origin, or product identity renders unless it is backed by ≥1 persisted `evidence` row, OR it is `status = 'unknown'` with an explicit uncertainty statement. Inferred claims additionally carry a stated `inference_basis` and cite the evidence the inference rests on.*

**Layer 1 — Database constraints** (cannot be bypassed by any code path):
- `shipments.source_evidence_id NOT NULL` — a shipment without evidence is unrepresentable.
- `events_inference_ck` — inferred ⇒ `inference_basis` present.
- `events_unknown_ck` / `pm_unknown_zero_ck` — unknown ⇒ confidence 0.
- `events_band_ck` — status↔confidence bands (below) enforced in-row.
- `claim_one_target_ck` — every claim-evidence link points at exactly one claim.
- `products.identity_evidence_id NOT NULL` — even product identity cites its lookup source (this is also where OFF's ODbL attribution obligation is carried into the UI).

**Layer 2 — Write gate.** The reconstruction engine and seed loader share one persistence function:

```ts
// src/lib/trace/persist.ts
export async function persistEvent(
  tx: Db, event: NewSupplyChainEvent, evidenceIds: string[],
): Promise<string> {
  if (event.status !== "unknown" && evidenceIds.length === 0)
    throw new EvidenceIntegrityError(event); // refuses — LLM output cannot create edges bare
  // insert event + claim_evidence rows atomically
}
```

The LLM may extract/normalize/classify/summarize provider payloads, but its output only reaches the graph through `persistEvent` — there is no other insert path for events in the codebase (enforced by convention + a lint-greppable rule: `db.insert(supplyChainEvents)` appears only in `persist.ts`).

**Layer 3 — Read gate (defense in depth).** `serializeTrace(traceId)` in `src/lib/trace/serialize.ts` joins events → claim_evidence → evidence. Any event whose status is not `unknown` but has zero surviving evidence rows is **demoted to `unknown` at render time** (confidence 0, summary replaced with a standard integrity notice) and logged as an invariant violation. The UI therefore *cannot* display a sourced-looking stage without sources even if layers 1–2 were somehow subverted (e.g., manual DB edits). The Sources tab and evidence drawer render exclusively from these joined rows — source name, type, date, "View source" link are all `evidence` columns, never free text on the event.

**Layer 4 — Seed/CI assertions.** `SeedFileSchema.superRefine` rejects violating seed files before any DB write; `scripts/seed.ts` re-asserts in SQL post-insert (§3.3-4a) inside the transaction; a CI check runs the same assertions against the migrated+seeded database.

**5.4 Deterministic confidence bands.** Status is derived from evidence, and confidence is constrained by status — both inspectable in the evidence drawer:

| Band | Meaning (per spec) | Status | Enforcement |
|---|---|---|---|
| 95–100 | direct structured traceability (EPCIS/GS1 Digital Link/certifier record) | `verified` | `events_band_ck` (verified: 85–100) |
| 85–94 | explicit manufacturer documentation, or ≥2 independent primary sources | `verified`/`documented` | same |
| 70–84 | strong combination of independent records | `documented` (70–94) | same |
| 50–69 | reasonable inference from sourced evidence | `inferred` (1–84) | + `inference_basis` required |
| <50 | excluded from `bestPath` unless the UI marks it "low confidence" | `inferred` | engine rule: bestPath filter `confidence >= 50`; lower goes to `altPaths` only |
| 0 | no evidence | `unknown` | confidence forced to 0 |

Seed confidences were assigned by a fixed rubric (single manufacturer doc = 85–90 documented; manufacturer doc with type-level ambiguity = 70–80; inference from label + public customs index = 76–80; inference from geography/logistics necessity = 52–64), and the same rubric is the v1 engine's scoring table — deterministic, no LLM in the loop for scoring.

---

## Build-time verification checklist (carried in README)

1. Physically scan each seeded UPC (retail packaging) on iPhone Safari + Android Chrome; confirm `normalizeGtin` lands on the seeded GTIN-14.
2. Resolve the two `needsVerification` evidence rows: Patagonia factories page (site was anti-bot/outage to automated fetches on 2026-08-12) and the FDC permalink for Bob's Red Mill.
3. Hand-run the GS1 US Company Database web lookups (≤30/day free) for prefixes `0078742`, `0858010`, `0190646` to add `gs1_registry` evidence fixtures for the mocked GS1 adapter.
4. End-to-end GS-separator test: decode the demo DataMatrix through `barcode-detector` → `@valentynb/gs1-parser` and assert AI(10) = `TRACE-DEMO` survives.
5. Re-pull OFF records for the five food products and refresh `retrievedAt`/`supportingText` (ODbL attribution strings render from `evidence.license`).

Sources: [OFF Tony's record](https://world.openfoodfacts.org/product/0858010005580), [OFF Oatly record](https://world.openfoodfacts.org/product/0190646641016), [OFF California Olive Ranch record](https://world.openfoodfacts.org/product/0850687110505), [OFF Counter Culture record](https://world.openfoodfacts.org/product/0663505002063), [OFF Great Value water record](https://world.openfoodfacts.org/product/0078742351926), [UPCitemdb Patagonia P-6 tee](https://www.upcitemdb.com/upc/888336749295), [USDA FDC search API](https://api.nal.usda.gov/fdc/v1/foods/search), [Tony's FAIR report](https://tonyschocolonely.com/pages/annual-fair-report-2024-2025), [Barry Callebaut × Tony's partnership](https://www.barry-callebaut.com/en/about-us/media/news-stories/barry-callebaut-and-tonys-chocolonely-sign-strategic-partnership-agreement), [ImportYeti Tony's supplier page](https://www.importyeti.com/supplier/tony-s-chocolonely), [Panjiva Tony's Inc](https://panjiva.com/Tony-s-Chocolonely-Inc/129294241), [Counter Culture Transparency Report 2025](https://counterculturecoffee.com/pages/transparency-report-2025), [Counter Culture Durham training center](https://counterculturecoffee.com/learn/training-centers/durham-training-center), [Tasting Table Durham HQ](https://www.tastingtable.com/691861/counter-culture-coffee-durham-nc-new-training-center/), [COR 100% California](https://www.californiaoliveranch.com/collections/california-olive-ranch-100-california), [COR Our Story](https://www.californiaoliveranch.com/our-story), [Farm Progress Artois](https://www.farmprogress.com/farm-business/artois-calif-destined-to-be-u-s-olive-oil-capital), [Oatly Sustainability Update 2024](https://a.storyblok.com/f/107921/x/cbdb92c917/oatly-sustainability-update-2024.pdf), [Oatly Fort Worth PR](https://investors.oatly.com/news-releases/news-release-details/fort-worth-chamber-commerce-welcomes-oatly-town), [Oatly NA facilities PR](https://investors.oatly.com/news-releases/news-release-details/oatly-transitions-north-america-production-facilities-100), [Manufacturing Dive Ya Ya Foods](https://www.manufacturingdive.com/news/oatly-ya-ya-foods-american-partnership/639537/), [Bob's Red Mill Wikipedia](https://en.wikipedia.org/wiki/Bob%27s_Red_Mill), [Bob's Red Mill oats](https://www.bobsredmill.com/products/oats), [Patagonia factories page](https://www.patagonia.com/factories-farms-material-suppliers/), [Patagonia supplier list XLSX](https://eu.patagonia.com/on/demandware.static/-/Library-Sites-PatagoniaShared/default/dw55edb3c8/PDF-EU/Patagonia-Finished-Goods-Supplier-List-May-2020.xlsx), [Open Supply Hub](https://opensupplyhub.org)