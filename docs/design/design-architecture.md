# Trace — Backend & Application Architecture Design (v1 vertical slice)

**Status:** Design, not implemented. **Date:** 2026-08-12.
**Scope:** Repo layout, provider adapter layer, reconstruction engine, confidence model, API contracts, caching, LLM boundaries, error handling, env/deploy. Frontend visual design and scanner internals are covered by a companion doc; this doc defines every contract they consume.

**Stack decisions (fixed):** Next.js 16.3 App Router (spec says "15+"; 16.3.0 is current stable), React 19.2, TypeScript, Tailwind v4, shadcn CLI 4.x (`npx shadcn init -b radix` — the evidence drawer uses vaul, which is Radix-based; do not mix primitive bases), **Neon Postgres via Vercel Marketplace** (Vercel Postgres is sunset), **drizzle-orm 0.45.2 + drizzle-kit 0.31.10** over `@neondatabase/serverless` (`drizzle-orm/neon-http`), **Zod 4.4.x**, `cacheComponents: true` from day one. **No PostGIS** — v1 does zero spatial queries (lat/lng are plain `double precision` rendered client-side by MapLibre; great-circle arcs are computed in the browser with turf). PostGIS is available on Neon free tier if v2 ever needs `ST_DWithin`, so nothing is foreclosed.

---

## 1. Directory layout

```
trace/
├── app/
│   ├── layout.tsx                      # fonts, theme, OFF/FDC/OSH attribution footer
│   ├── page.tsx                        # "Where did this come from?" — scan + manual entry + example traces
│   ├── manifest.ts                     # MetadataRoute.Manifest (PWA)
│   ├── scan/page.tsx                   # camera scanner (client component tree)
│   ├── search/page.tsx                 # manual UPC entry / paste / recent scans
│   ├── product/[gtin]/
│   │   ├── layout.tsx                  # product identity header + tab nav (server, cached)
│   │   ├── page.tsx                    # Journey tab (timeline)
│   │   ├── map/page.tsx                # Map tab (dynamic ssr:false wrapper)
│   │   ├── sources/page.tsx            # Sources tab
│   │   └── not-found.tsx               # "No match" editorial state
│   └── api/
│       ├── products/
│       │   ├── lookup/route.ts         # POST — resolve raw scan value → identity
│       │   └── [gtin]/
│       │       ├── route.ts            # GET — identity + trace status summary
│       │       ├── trace/route.ts      # GET — full trace + pipeline step states (polling target)
│       │       └── sources/route.ts    # GET — evidence cards
│       └── trace/
│           └── reconstruct/route.ts    # POST — enqueue/run reconstruction (202 + after())
├── components/
│   ├── ui/                             # shadcn-managed
│   ├── scanner/                        # camera-view.tsx, detector-loop.ts, scan-feedback.tsx
│   ├── journey/                        # timeline.tsx, event-node.tsx, progress-checklist.tsx
│   ├── evidence/                       # evidence-drawer.tsx, evidence-card.tsx, confidence-badge.tsx, status-pill.tsx
│   └── map/                            # route-map.tsx (client), map-loader.tsx (ssr:false wrapper)
├── lib/
│   ├── gtin.ts                         # normalize/validate/derive GTIN forms + GS1 AI parse
│   ├── confidence.ts                   # PURE deterministic scoring (see §4)
│   ├── confidence.test.ts              # vitest unit tests
│   ├── schemas/
│   │   ├── domain.ts                   # Zod: Gtin, TraceStatus, EventType, ConfidenceBand…
│   │   └── api.ts                      # Zod: request/response for all 5 routes (see §5)
│   ├── engine/
│   │   ├── reconstruct.ts              # reconstructSupplyChain(productId, opts)
│   │   ├── stages.ts                   # ordered stage runners
│   │   ├── paths.ts                    # candidate-path build + rank
│   │   └── persist.ts                  # event/evidence/claim_evidence writers (insert-only)
│   ├── llm/
│   │   ├── client.ts                   # lazy Anthropic client; null if no ANTHROPIC_API_KEY
│   │   └── extract.ts                  # guarded extraction/summarization helpers (§7)
│   ├── errors.ts                       # AppError taxonomy + toResponse()
│   └── http.ts                         # fetchWithTimeout(url, {signal, headers}) — AbortSignal.timeout
├── db/
│   ├── schema.ts                       # Drizzle schema (all tables below)
│   ├── client.ts                       # drizzle(neon(DATABASE_URL))
│   ├── migrations/                     # drizzle-kit generate output (checked in)
│   ├── seed.ts                         # tsx entrypoint; reads seed-data/, uses same evidence pipeline
│   └── seed-data/
│       ├── products/*.json             # oatly-oat-drink.json, tonys-milk-chocolate.json, cafe-bustelo.json,
│       │                               # kirkland-olive-oil.json, patagonia-tee.json, topo-chico.json…
│       ├── evidence/*.json             # verbatim excerpts + URLs from verified disclosures
│       └── fixtures/*.json             # mock BoL records, GS1 licensee rows, EPCIS event docs
├── providers/
│   ├── types.ts                        # interfaces + RawObservation (see §2)
│   ├── registry.ts                     # capability registry + fallback chains
│   ├── live/
│   │   ├── open-food-facts.ts          # OFF v3 (+ Products/Beauty/PetFood hosts as fallback)
│   │   ├── fdc.ts                      # USDA FoodData Central
│   │   ├── openfda-recalls.ts          # /food + /drug enforcement
│   │   ├── upcitemdb.ts                # trial tier, non-food fallback
│   │   └── curated-disclosures.ts      # seeded corporate reports + Open Supply Hub extract
│   └── mock/
│       ├── gs1-company.ts              # prefix → licensee (GS1 US Data Hub shape)
│       ├── bill-of-lading.ts           # ImportYeti/Panjiva record shape
│       └── epcis.ts                    # item-level EPCIS 2.0 events for BATCH TRACE demo
├── scripts/
│   ├── fetch-open-supply-hub.ts        # one-time: CSV download → seed-data (CC BY-SA attribution kept)
│   └── ingest-disclosure.ts            # build-time: URL/PDF → evidence JSON (optionally LLM-assisted, §7)
├── drizzle.config.ts
├── next.config.ts                      # cacheComponents: true, partialPrefetching: true
├── .env.example
├── vitest.config.ts
└── README.md
```

### Database schema (Drizzle, `db/schema.ts`) — signatures

Insert-only tables are marked ⊕ (no UPDATE/DELETE in app code; corrections are new rows).

```ts
products            (id uuid pk, gtin14 varchar(14) unique not null, upc12 varchar(12), name text,
                     brand_id → companies.id, manufacturer_id → companies.id, category text,
                     image_url text, description text, ingredients_text text, created_at, updated_at)
companies           (id uuid pk, name text not null, canonical_key text unique,  -- lower/trimmed for dedupe
                     parent_company_id → companies.id, website text, country char(2), company_type
                     enum('brand','manufacturer','supplier','logistics','retailer'))
facilities          (id uuid pk, company_id → companies.id, name text, facility_type
                     enum('farm','processing','factory','port','warehouse','distribution','hq'),
                     city text, region text, country char(2), lat double precision, lng double precision,
                     os_id text)                        -- Open Supply Hub ID when sourced there
materials           (id uuid pk, name text, category text)
product_materials   (product_id, material_id, origin_country char(2), origin_region text, pk(product_id, material_id))
shipments        ⊕  (id uuid pk, origin_facility_id, destination_facility_id, origin_port text, destination_port text,
                     transport_mode enum('ocean','air','rail','truck'), departed_on date, arrived_on date,
                     hs_code text, source_evidence_id → evidence.id not null)   -- a shipment is nothing without evidence
evidence         ⊕  (id uuid pk, provider_id text not null, source_name text not null, source_url text,
                     source_type enum(SourceType), publication_date date, retrieved_at timestamptz not null,
                     supporting_text text not null, raw_response jsonb not null,
                     extracted_fields jsonb, extraction_method enum('deterministic','llm'),
                     content_hash text not null, unique(source_url, content_hash))
supply_chain_events⊕(id uuid pk, trace_id → traces.id, product_id → products.id, seq int not null,
                     event_type enum('material_origin','processing','manufacturing','export','ocean_freight',
                       'air_freight','import','distribution','retail','recall','scan'),
                     company_id, facility_id, location_label text, lat double precision, lng double precision,
                     date_from date, date_to date,
                     status enum('verified','documented','inferred','unknown','observed') not null,
                     confidence smallint not null,       -- 0–100
                     evidence_summary text,              -- "Why we think this" copy
                     uncertainty_note text)              -- explicit statement when status != verified
claim_evidence   ⊕  (event_id → supply_chain_events.id, evidence_id → evidence.id,
                     role enum('primary','corroborating'), pk(event_id, evidence_id))
traces              (id uuid pk, product_id, gtin14, mode enum('product','batch'), lot text, 
                     status enum('queued','running','complete','failed','degraded'),
                     steps jsonb not null,               -- [{key, label, state:'pending'|'active'|'done'|'skipped'|'error'}]
                     alt_paths jsonb,                    -- ranked alternative paths (event-id lists + scores)
                     computed_at timestamptz, error_code text, created_at)
                     -- partial unique index: unique(gtin14, coalesce(lot,'')) where status in ('queued','running')
scans            ⊕  (id uuid pk, gtin14, raw_value text, symbology text, ais jsonb, locality text, created_at)
                     -- locality is approximate ("Upper East Side, New York"); NO raw coordinates ever stored
provider_fetches    (provider_id text, cache_key text, fetched_at timestamptz, ok boolean,
                     pk(provider_id, cache_key))         -- upstream re-fetch throttle (§6)
```

Enable `pg_trgm` + `unaccent` in migration 0001 for fuzzy recall/company-name matching (both supported on Neon: [pg_trgm](https://neon.com/docs/extensions/pg_trgm), [unaccent](https://neon.com/docs/extensions/unaccent)).

**Evidence-integrity invariants (enforced in `lib/engine/persist.ts`, the only module allowed to write these tables):**
1. `evidence` rows are immutable snapshots of what a provider returned (verbatim `supporting_text` + full `raw_response`). Re-fetches insert new rows; `(source_url, content_hash)` dedupes.
2. A `supply_chain_events` row with status ≠ `unknown` **must** have ≥1 `claim_evidence` link — enforced by `persistEvent()` refusing to write otherwise (and by a CI test). `unknown` events have `confidence = 0` and zero links: they are first-class gap markers, never guesses.
3. `shipments.source_evidence_id` is `NOT NULL` at the schema level.

---

## 2. Provider adapter layer

### 2.1 Interfaces (`providers/types.ts`)

```ts
export type Gtin = string & { __brand: "gtin14" };           // constructed only via lib/gtin.ts

export type SourceType =
  | "epcis_event" | "gs1_digital_link" | "gs1_registry"
  | "government_record" | "recall_notice"
  | "manufacturer_disclosure" | "certification_record"
  | "customs_record" | "open_database" | "commercial_database"
  | "user_observation";

/** Immutable observation. Adapters RETURN these; only persist.ts writes them; nothing ever mutates them. */
export interface RawObservation {
  providerId: string;
  sourceType: SourceType;
  sourceName: string;               // "Open Food Facts", "USDA FoodData Central", …
  sourceUrl: string | null;
  publicationDate: string | null;   // ISO date, if the source states one
  retrievedAt: string;              // ISO datetime (now)
  supportingText: string;           // verbatim excerpt that supports the claim
  structured: Record<string, unknown>; // deterministic parse of the payload
  raw: unknown;                     // full response snapshot
}

export type ProviderResult<T> =
  | { ok: true; data: T; observations: RawObservation[] }
  | { ok: false; error: { code: "timeout" | "rate_limited" | "http_error" | "parse_error"; detail: string } };

export interface ProductIdentity {
  gtin14: Gtin; name: string | null; brand: string | null; brandOwner: string | null;
  categories: string[]; imageUrl: string | null; ingredientsText: string | null;
  originsText: string | null; manufacturingPlacesText: string | null;
}

export interface ProductLookupProvider {
  readonly id: string;
  lookup(gtin: Gtin, signal: AbortSignal): Promise<ProviderResult<ProductIdentity | null>>;
}
export interface TradeDataProvider {
  readonly id: string;
  shipments(q: { consigneeName?: string; shipperName?: string; hsCodePrefix?: string },
            signal: AbortSignal): Promise<ProviderResult<ShipmentRecord[]>>;
}
export interface FacilityProvider {
  readonly id: string;
  facilities(q: { companyName: string; country?: string },
             signal: AbortSignal): Promise<ProviderResult<FacilityRecord[]>>;
}
export interface TraceabilityProvider {
  readonly id: string;
  itemTrace(q: { gtin: Gtin; lot?: string; serial?: string },
            signal: AbortSignal): Promise<ProviderResult<EpcisEvent[]>>;
}
/** Fifth interface beyond the mandated four — recall DBs don't fit the others cleanly. */
export interface RecallProvider {
  readonly id: string;
  recalls(q: { gtin: Gtin; brand?: string; firm?: string },
          signal: AbortSignal): Promise<ProviderResult<RecallRecord[]>>;
}
```

### 2.2 Concrete adapters — LIVE vs MOCK (per verified research)

| Adapter | Interface | v1 status | Endpoint / notes |
|---|---|---|---|
| `open-food-facts` | ProductLookup | **LIVE** | `GET https://world.openfoodfacts.org/api/v3/product/{barcode}?fields=…`; mandatory `User-Agent: ${OFF_USER_AGENT}`; also retried against `world.openproductsfacts.org` / `world.openbeautyfacts.org` / `world.openpetfoodfacts.org` (same shape) before giving up. `sourceType: "open_database"`. ODbL attribution rendered in layout footer; OFF-derived fields stay in evidence rows (separable layer) to contain share-alike. |
| `fdc` | ProductLookup | **LIVE** | `GET https://api.nal.usda.gov/fdc/v1/foods/search?query={gtin}&dataType=Branded&api_key=…`; verify `foods[].gtinUpc` equals scanned code after 12↔13/14-digit zero normalization. `brandOwner` is the highest-value provenance field. CC0. `sourceType: "government_record"`. |
| `openfda-recalls` | Recall | **LIVE** | `GET https://api.fda.gov/food/enforcement.json?search=…` (+`/drug/`). Match `recalling_firm`/brand tokens plus UPC as free text in `code_info`/`product_description`, trying raw digits and space-grouped `d ddddd ddddd d` variants; server-side pg_trgm assist on persisted rows. Presented as historical notice, never live status. `sourceType: "recall_notice"`. |
| `upcitemdb` | ProductLookup | **LIVE** (demo-grade) | `GET https://api.upcitemdb.com/prod/trial/lookup?upc={gtin}`; keyless, 100/day — acceptable because provider_fetches throttling + product cache make it a last-resort fallback. `sourceType: "commercial_database"`. |
| `curated-disclosures` | Facility + (identity enrich) | **LIVE (static)** | Seeded from verified URLs: Oatly sustainability reports (storyblok PDF + investors.oatly.com), Tony's FAIR report 2024/25, Patagonia supplier pages (pulled via the Open Supply Hub copy for stability), plus ≤5,000-row OSH extract (CC BY-SA 4.0, attributed). Reads only from `db/seed-data/evidence/*.json`. `sourceType: "manufacturer_disclosure"` / `"certification_record"`. |
| `gs1-company` (mock) | ProductLookup (licensee resolution step) | **MOCK** | Models GS1 US Data Hub licensee lookup: `{ prefix, licenseeName, country, status }`. Fixtures hand-seeded via the free GS1 US web UI (30 searches/day — legal). Documented upgrade path: Data Hub API (~$500/yr) drops in behind the same interface. |
| `bill-of-lading` (mock) | TradeData | **MOCK** | ImportYeti/Panjiva record shape: `{ shipper, consignee, hsCode, originPort, destinationPort, arrivalDate, weightKg, containerCount }`. All real sources are paid; CBP AMS is not FOIA-able. Mock records ship only for seed products and are labeled `sourceName: "Sample customs manifest (mock)"` — the UI badge for these reads "Illustrative — commercial data source not connected". |
| `epcis` (mock) | Traceability | **MOCK** | EPCIS 2.0 `ObjectEvent`/`AggregationEvent` JSON for one seed product+lot, enabling a real BATCH TRACE demo. `digital-link.js@1.4.3` parses GS1 Digital Link URIs client-side (that part is real); the resolver endpoint is mocked. |

GS1 AI parsing of raw scans uses `@valentynb/gs1-parser@2.0.0` in `lib/gtin.ts` (AI 01/10/17; GS 0x1D preserved by the zxing-wasm decode path — covered in the frontend doc).

### 2.3 Registry & fallback chains (`providers/registry.ts`)

```ts
export const registry = {
  productLookup:  [openFoodFacts, fdc, gs1CompanyMock, upcitemdb],  // ordered chain
  tradeData:      [billOfLadingMock],
  facilities:     [curatedDisclosures],
  traceability:   [epcisMock],
  recalls:        [openFdaRecalls],
} as const;

/** First-success chain: returns first ok+non-null; accumulates ALL observations from every provider that responded. */
export async function runChain<T>(providers, call, { timeoutMs = 4000 }): Promise<{ data: T | null; observations: RawObservation[]; degraded: boolean }>;

/** Fan-out merge (used for facilities/recalls): run all, merge, never throw. */
export async function runAll<T>(providers, call, { timeoutMs = 4000 });
```

Per-provider call: `AbortSignal.timeout(4000)`; one retry on 5xx with 500ms jitter; `429/503` from OFF marks the provider `rate_limited` (skip, don't retry) and the chain continues. Before any network call, `provider_fetches` is consulted: if `(provider_id, cache_key)` was fetched inside its TTL (OFF 24h, FDC 7d, openFDA 24h, UPCitemdb 7d), the adapter re-reads the previously persisted evidence rows instead of calling out — this is what keeps us under OFF's 15 req/min/IP through a server-side proxy at v1 traffic.

**Observations → Evidence:** every `RawObservation` returned by any adapter during a pipeline run is passed to `persistEvidence(obs)` (insert-only, deduped by content hash) *before* any graph reasoning happens. The engine then works exclusively from persisted evidence IDs, so every edge is traceable to a row that can never change underneath it.

---

## 3. Reconstruction engine

### 3.1 Entry point

```ts
// lib/engine/reconstruct.ts
export async function reconstructSupplyChain(
  traceId: string,            // pre-created traces row (status 'queued')
): Promise<void>              // all output goes to DB; throws only on programmer error
```

### 3.2 Pipeline stages (each updates `traces.steps` transactionally as it starts/ends)

| # | step key | label (UI checklist) | What it does |
|---|---|---|---|
| 1 | `identify` | "Product identified" | Load persisted `ProductIdentity`; upsert `products`, brand `companies` row (canonical_key dedupe). Already done at lookup time for cached products — then instantly `done`. |
| 2 | `manufacturer` | "Finding manufacturer" | FDC `brandOwner` + GS1 prefix mock → manufacturer/parent `companies`; link `parent_company_id`. |
| 3 | `origins` | "Locating origin data" | OFF `origins`/`manufacturing_places` (sparse — treated as optional) + curated disclosures → `materials`, `product_materials`, origin/processing facility candidates. |
| 4 | `facilities` | "Mapping facilities" | FacilityProviders by company name → `facilities` (with OSH os_id + lat/lng when present). |
| 5 | `trade` | "Checking trade records" | TradeDataProviders by consignee/shipper name → `shipments` (mock in v1) + port facilities. |
| 6 | `recalls` | "Screening recall databases" | RecallProviders → recall `supply_chain_events` (type `recall`, off-path annotations). |
| 7 | `route` | "Building route" | Candidate-path construction + ranking (§3.3); persist events + claim_evidence; if mode=`batch`, TraceabilityProvider events take precedence and the trace is labeled BATCH TRACE, else PRODUCT TRACE. |
| 8 | `finalize` | — | Compute confidences (§4), write `evidence_summary`/`uncertainty_note` (template or LLM, §7), append the terminal `scan` event (status `observed`, locality label), set `status='complete'` (or `'degraded'` if any stage errored but a path exists), stamp `computed_at`. |

A stage that finds nothing marks its step `done` and inserts an **`unknown` event** where the chain requires a hop (e.g., "Ocean freight — Unknown", confidence 0, uncertainty_note: "No shipping records available for this product. US import routing shown as a gap, not a guess."). Sparse accurate beats rich fictional: stages never fabricate placeholders with nonzero confidence.

### 3.3 Candidate paths — build & rank (`lib/engine/paths.ts`)

- **Node set:** material origins → processing facilities → manufacturing → export port → import port → US distribution → scan locality. Nodes exist only if at least one persisted evidence row (or an explicit `unknown` gap) supports them.
- **Edge creation:** an edge (A→B) is proposed only when a rule fires over evidence: same-document co-mention (disclosure names both farm region and processing site), shipment record (origin/destination ports), corporate ownership (facility.company_id chain), or category heuristic **explicitly registered as an inference rule** (e.g., "EU manufacture + US retail ⇒ ocean freight via nearest major container ports" — rule id `infer:eu-us-ocean`, always `status='inferred'`). Every edge stores its rule id and contributing evidence ids.
- **Scoring:** edge score = claim confidence from §4. Path score = `min(edgeConf)` (bottleneck), tie-broken by arithmetic mean, then by fewer inferred hops, then by lexicographic node ids — fully deterministic. Edges `<50` are excluded from the primary path; if exclusion disconnects the chain, the gap becomes an `unknown` event instead.
- **Output:** best path → `supply_chain_events` rows with `seq`; up to 2 alternatives → `traces.alt_paths` jsonb (`{score, eventIds[]}`) — YAGNI: alternates are read-only JSON, not first-class rows.

### 3.4 Idempotency & orchestration on Vercel

- `POST /api/trace/reconstruct` flow: validate → normalize GTIN → check for a **fresh** trace (`status='complete'` and `computed_at > now() - TRACE_TTL_HOURS` (default 168h) and same `(gtin14, lot)`) → if fresh, return `200 {traceId, fresh: true}` and do nothing. Never re-run the full pipeline for the same GTIN inside the TTL.
- Otherwise `INSERT traces (status 'queued')`; the partial unique index on `(gtin14, coalesce(lot,'')) WHERE status IN ('queued','running')` makes concurrent kickoffs collapse — on conflict, return the existing running trace's id (`202`).
- The route handler returns `202 {traceId}` immediately and schedules the pipeline with **stable `after()` from `next/server`** (runs post-response, within `maxDuration`). `export const maxDuration = 300` on this route (Hobby cap). Expected pipeline wall time: 10–40s (bounded by ~6 provider calls × 4s timeout + LLM summary if enabled). A `running` trace older than 5 minutes is treated as crashed: next reconstruct request marks it `failed` and starts anew.

### 3.5 Progressive status → UI: **DB-persisted step states + client polling** (decision)

The client `POST`s reconstruct, then polls `GET /api/products/[gtin]/trace` every **1200ms** while `status ∈ {queued, running}` and renders `steps` as the live checklist (`Product identified ✓ / Finding manufacturer ● / …`), stopping on terminal status.

Why polling beats SSE here (all grounded in the verified research):
1. **Function economics on Hobby:** SSE holds one serverless invocation open per viewer for the life of the stream, and streaming time counts against the 300s `maxDuration`. Polling GETs are ~50ms invocations against a single indexed row — fluid compute handles them essentially free.
2. **Mobile Safari reality:** this app's core loop backgrounds the page constantly (camera → app switch → lock screen). iOS kills open connections on background; SSE needs reconnect + replay logic, while polling resumes trivially on `visibilitychange` with zero lost state because the state lives in Postgres, not in a stream.
3. **Crash/reload safety:** steps are durable — a reload mid-reconstruction lands on the same checklist. SSE state would need the same DB persistence *anyway*, making the stream pure overhead.
4. A 1.2s cadence over a ≤40s pipeline is ≤34 requests per trace — imperceptible latency difference from SSE for a checklist UI.

---

## 4. Deterministic confidence model (`lib/confidence.ts`)

Pure, synchronous, side-effect-free. Inputs: the evidence rows linked to a claim + the claim's inference depth. No randomness, no clock reads (caller passes `asOf: Date` — defaults to trace `computed_at`, so a persisted trace re-scores identically forever). Unit-tested in `lib/confidence.test.ts` (vitest).

```ts
export type EvidenceInput = {
  sourceType: SourceType;
  publicationDate: string | null;
  sourceDomain: string;                 // for independence grouping
  specificity: "exact_item" | "exact_product" | "brand_level" | "company_level";
};

export function scoreClaim(evidence: EvidenceInput[], inferredDepth: number, asOf: Date):
  { confidence: number; status: "verified" | "documented" | "inferred" | "unknown" };
```

**Step 1 — per-evidence weight** `w = BASE[sourceType] × recency × SPEC[specificity]`

| sourceType | BASE | half-life (yrs) | | specificity | SPEC |
|---|---|---|---|---|---|
| epcis_event | 0.97 | 3 | | exact_item | 1.00 |
| gs1_digital_link | 0.96 | 3 | | exact_product | 0.95 |
| gs1_registry | 0.93 | 5 | | brand_level | 0.85 |
| government_record | 0.90 | 5 | | company_level | 0.70 |
| recall_notice | 0.88 | 5 |
| manufacturer_disclosure | 0.86 | 2 |
| certification_record | 0.84 | 3 |
| customs_record | 0.78 | 3 |
| open_database | 0.60 | 2 |
| commercial_database | 0.55 | 2 |
| user_observation | 1.00 | — |

`recency = max(0.6, 0.5 ** (ageYears / halfLife))`; missing `publicationDate` → fixed `0.8`. (Old evidence degrades but never evaporates; the 0.6 floor keeps a 2019 sustainability report meaningful, per band intent.)

**Step 2 — corroboration (noisy-OR over independent sources).** Group evidence by `sourceDomain`; within a group take `max(w)` (same publisher doesn't stack); across groups: `combined = 1 − Π(1 − w_g)`. Two independent 0.8s → 0.96; corroboration bonus emerges naturally and monotonically.

**Step 3 — inference-chain penalty.** `raw = combined × 0.85 ** inferredDepth`, where `inferredDepth` = number of rule-inferred hops between this claim and its nearest directly-evidenced anchor (0 for direct claims). One inferred hop on a 0.92 base → 78 — matching the spec's "Ocean freight … Inferred 78%" texture.

**Step 4 — class caps + status (this is what maps to the spec's bands).**
- `direct` class = any evidence in {epcis_event, gs1_digital_link} with `exact_item|exact_product`, or government_record with `exact_product`.
- `documentary` class = any evidence in {manufacturer_disclosure, certification_record, gs1_registry, recall_notice}.
- Cap: `conf = round(100 × min(raw, cap))` where `cap = direct ? 1.00 : documentary ? 0.94 : 0.84`.
- Status:

```
user_observation present            → "observed", confidence 100
no evidence                         → "unknown", confidence 0
conf ≥ 95 (implies direct class)    → "verified"     // 95–100: direct structured traceability
conf ≥ 85 (implies documentary)     → "documented"   // 85–94: explicit manufacturer docs
conf ≥ 50                           → "inferred"     // 50–84: strong combination / reasonable inference
conf < 50                           → "unknown"      // excluded from primary path unless flagged
```

**Inspectability:** `scoreClaim` also returns a `breakdown` array (`{evidenceId, base, recency, spec, w}` + `{combined, depthPenalty, cap}`) which is persisted into the event's `evidence_summary` context and rendered verbatim in the evidence drawer's "Why we think this". Nothing about a confidence number is unexplainable.

**Unit tests (minimum):** single-source values per type; same-domain no-stacking; cross-domain noisy-OR monotonicity (adding evidence never lowers confidence); depth penalty at 0/1/2; caps enforce band boundaries (documentary-only can never emit ≥95); recency floor; determinism (fixed `asOf` → byte-identical output); status boundary values 49/50/84/85/94/95.

---

## 5. API routes + Zod schemas (`lib/schemas/api.ts`)

All handlers: `const parsed = Schema.safeParse(...)` → `400 {error:{code:"VALIDATION", issues}}` on failure. Shared primitives:

```ts
export const zGtinInput = z.string().regex(/^[0-9]{8,14}$/);           // pre-normalization
export const zGtin14   = z.string().regex(/^[0-9]{14}$/);
export const zStatus   = z.enum(["verified","documented","inferred","unknown","observed"]);
export const zConfidence = z.number().int().min(0).max(100);
export const zTraceState = z.enum(["queued","running","complete","failed","degraded"]);
export const zEvidenceCard = z.object({
  id: z.uuid(), sourceName: z.string(), sourceType: z.string(),
  sourceUrl: z.url().nullable(), publicationDate: z.string().nullable(),
  retrievedAt: z.string(), supportingText: z.string(),
});
export const zEvent = z.object({
  id: z.uuid(), seq: z.number().int(), eventType: z.string(),
  title: z.string(), locationLabel: z.string().nullable(),
  lat: z.number().nullable(), lng: z.number().nullable(),
  status: zStatus, confidence: zConfidence,
  evidenceSummary: z.string().nullable(), uncertaintyNote: z.string().nullable(),
  evidence: z.array(zEvidenceCard),
});
```

| Route | Method | Request (Zod) | Response (Zod) |
|---|---|---|---|
| `/api/products/lookup` | POST | `{ code: z.string().min(8).max(120), locality: z.string().max(80).optional() }` — `code` is the raw scan/paste value (UPC digits **or** GS1 element string / Digital Link URI) | `200 { product: zProductIdentity, gtin14, mode: z.enum(["product","batch"]), batch: {lot, expiry}.optional(), traceState: zTraceState.nullable() }` · `404 NO_MATCH` · `422 INVALID_BARCODE` — side effects: inserts `scans` row, warms product cache |
| `/api/products/[gtin]` | GET | path `zGtinInput` | `200 { product, trace: { id, state: zTraceState, computedAt } | null }` — cached identity, renders instantly post-scan |
| `/api/products/[gtin]/trace` | GET | path + `?traceId=uuid.optional()` | `200 { traceId, mode, state: zTraceState, steps: z.array({key,label,state}), events: z.array(zEvent), altPaths, recalls: z.array(zEvent), computedAt }` — **the polling target**; `events` grows as stages complete |
| `/api/products/[gtin]/sources` | GET | path | `200 { sources: z.array(zEvidenceCard.extend({ claimsSupported: z.array({eventId, title}) , category: z.string() })) }` |
| `/api/trace/reconstruct` | POST | `{ gtin: zGtinInput, mode: z.enum(["product","batch"]).default("product"), lot: z.string().max(40).optional(), force: z.boolean().default(false) }` (`force` honored only when `NODE_ENV !== "production"`) | `202 { traceId }` (started/already running) · `200 { traceId, fresh: true }` (TTL hit) · `404 NO_MATCH` · `422 INVALID_BARCODE` |

Error envelope everywhere: `{ error: { code: string, message: string, retryable: boolean } }`.

---

## 6. Caching strategy (three layers, DB is truth)

1. **Postgres (durable, cross-user):** products, evidence, events, traces — reconstruction is *never* re-run within `TRACE_TTL_HOURS` (§3.4); `provider_fetches` throttles upstream calls (per-provider TTLs in §2.3), which is also our rate-limit compliance mechanism for OFF/UPCitemdb.
2. **Next data cache (`use cache` — Cache Components, Next 16.3):** `getProductIdentity(gtin)` in `lib/` is a `"use cache"` function with `cacheTag(\`product:${gtin}\`)` + `cacheLife("days")`; the completed-trace read for server-rendered tabs uses `cacheTag(\`trace:${gtin}\`)` + `cacheLife("hours")`. Invalidation: `revalidateTag(\`trace:${gtin}\`, "max")` when `finalize` completes (called from the route-handler context; note the cacheComponents SWR signature). Do **not** use `unstable_cache` (deprecated) or fetch-option caching (legacy model).
3. **Route/HTTP layer:** the polling route (`/trace`) and `/lookup` are fully dynamic — no caching, correctness over speed. `GET /api/products/[gtin]` and `/sources` set `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400` (safe: public, unauthenticated, DB-backed). Product pages themselves are dynamic-with-cached-parts via partial prefetching; the identity shell streams from cache while trace data loads.

Never cached: scan submissions, reconstruct kicks, step states.

---

## 7. LLM usage boundaries (Anthropic API, optional)

**Hard rule, mechanically enforced:** the LLM never mints graph data. `lib/engine/persist.ts` is the only writer of events/edges, and it accepts only evidence-row IDs — there is no code path from an LLM response to an edge that bypasses evidence. The app runs 100% with `ANTHROPIC_API_KEY` unset: `lib/llm/client.ts` exports `getClient(): Anthropic | null`, and every call site has a deterministic fallback.

| Task | When it runs | With key | Without key (fallback) |
|---|---|---|---|
| **Extraction** — pull `{material, originCountry, facilityName, city}` tuples from disclosure PDFs/HTML | Build/ingest time only (`scripts/ingest-disclosure.ts`) | `client.messages.parse()` structured outputs (JSON schema, `additionalProperties: false`); **guard:** every extracted tuple must include a `quote` field that passes a post-hoc verbatim `sourceText.includes(quote)` check, else the tuple is dropped; results land in `evidence.extracted_fields` with `extraction_method:'llm'` | Regex/heuristic parsers for the seeded formats; or maintainer hand-writes `extracted_fields` in seed JSON |
| **Normalization** — canonical company names ("Oatly AB" ≡ "Oatly, Inc.") | Ingest time | LLM proposes `canonical_key` merges; applied only when both rows already exist from evidence | `lower(unaccent(trim()))` + pg_trgm similarity ≥ 0.6 |
| **Classification** — map scraped docs to `SourceType`/category | Ingest time | Single-label classification, enum-constrained via structured output | Static mapping by source domain |
| **Summarization** — `evidence_summary` ("Why we think this") prose | `finalize` stage, inside `after()` budget | Prompt contains *only* the linked evidence excerpts + confidence breakdown; instruction: "State only what the excerpts support; name each source." Output is display copy, stored on the event, never parsed back into data | Template: `"Based on {n} source(s) including {sourceName}: {supportingText₁}. {uncertaintyNote}"` |

SDK: `@anthropic-ai/sdk` (official TS SDK; never raw fetch). Model: `ANTHROPIC_MODEL` env, default **`claude-opus-4-8`**. Bulk ingest of many disclosures should use the **Message Batches API** (50% price, results within ~1h — fine for build-time). Request-time LLM usage is zero except the optional finalize summary; a summary failure downgrades to template, never fails the trace.

---

## 8. Error handling matrix

`lib/errors.ts` defines `AppError { code, httpStatus, retryable, userMessage }`; route handlers map via `toResponse(err)`.

| Scenario | Detection | Server behavior | Client behavior |
|---|---|---|---|
| **Invalid barcode** | `lib/gtin.ts` mod-10 check-digit fail / bad length / unparseable GS1 string | `422 INVALID_BARCODE` (no scan row) | Scanner keeps running with inline "Not a valid product code" toast; manual-entry field shows per-digit validation |
| **No match** | Full productLookup chain returns `null` everywhere | `404 NO_MATCH`; scan row still persisted (future coverage signal); stub product NOT created | Editorial empty state: "We couldn't identify this barcode" + retry, manual search, and category note ("non-food coverage is limited") |
| **Provider timeout** | `AbortSignal.timeout(4000)` → adapter `{ok:false, code:'timeout'}` | Chain continues to next provider; if a *stage* ends with zero data, step → `done` + `unknown` gap event; if identity itself unresolvable due to timeouts (distinct from confirmed miss) → `503 UPSTREAM_UNAVAILABLE, retryable:true, Retry-After: 10` | Trace banner: "Some sources were unreachable — this trace may be incomplete" (state `degraded`), with re-run affordance after TTL |
| **Provider rate-limited** | HTTP 429/503 from OFF/UPCitemdb | Mark provider skipped for this run; `provider_fetches` backoff row (15 min); serve persisted evidence if any | Indistinguishable from timeout path (by design) |
| **Network failure (client)** | fetch rejects / navigator.onLine false | — | Cached identity (layer-2 cache / previously fetched) renders; polling backs off exponentially (1.2s → 10s cap) and resumes on `online`/`visibilitychange`; scan queue holds last code for retry |
| **Duplicate scan** | Client: same decoded value within 2.5s → ignored (debounce). Server: reconstruct kick for in-flight gtin | Partial unique index collapses to existing trace → `202` with same `traceId`; fresh-TTL hit → `200 fresh:true`. Scans table still records each distinct submission | Navigates to the same `/product/[gtin]`; no duplicate pipeline, no duplicate spinner |
| **Pipeline crash mid-run** | `running` trace with `updated_at` > 5 min old | Next reconstruct marks `failed`, starts a new trace; `steps` show `error` on the failed step | Checklist shows failed step + "Try again" |
| **LLM failure** | SDK typed errors (RateLimitError, APIStatusError…) | Fall back to template summary; log; never fails trace | Invisible |

---

## 9. Env template & Vercel deploy

### `.env.example`

```bash
# --- Database (auto-injected by the Neon integration from Vercel Marketplace) ---
DATABASE_URL=                     # pooled; used by app runtime (drizzle-orm/neon-http)
DATABASE_URL_UNPOOLED=            # direct; used by drizzle-kit migrate

# --- Providers ---
OFF_USER_AGENT="Trace/0.1 (contact@yourdomain.example)"   # REQUIRED by Open Food Facts
FDC_API_KEY=                      # free at api.data.gov/signup (DEMO_KEY works for dev, 30/hr)
OPENFDA_API_KEY=                  # optional; raises daily limit 1k → 120k
UPCITEMDB_ENABLED=true            # trial tier, 100 lookups/day — flip off if exhausted

# --- LLM (fully optional; app runs without it) ---
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-8

# --- App ---
TRACE_TTL_HOURS=168               # never re-run reconstruction inside this window
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
```

### Deploy story

1. **Provision:** Vercel project (Framework: Next.js, Node 22) + Neon Free via Vercel Marketplace — env vars auto-wired; run `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` via migration 0001.
2. **Build command:** `npm run build` where `package.json` has:
   ```json
   "build": "drizzle-kit migrate && next build",
   "db:generate": "drizzle-kit generate",
   "db:seed": "tsx ./db/seed.ts"
   ```
   Migrations-at-build against `DATABASE_URL_UNPOOLED` is the standard Drizzle+Neon+Vercel pattern ([Neon Drizzle guide](https://neon.com/docs/guides/drizzle), [Drizzle Neon tutorial](https://orm.drizzle.team/docs/tutorials/drizzle-with-neon), [Neon local+Vercel guide](https://neon.com/guides/drizzle-local-vercel)); migrations are checked in and idempotent, so preview + production builds are safe. Seeding is a one-time manual `npm run db:seed` (local, pointing at the Neon URL), not part of build.
3. **Region:** function region `iad1` (us-east) co-located with the Neon project region (`aws-us-east-1`) — keeps neon-http round-trips ~1–3ms; the whole app is HTTPS by default, satisfying getUserMedia.
4. **Route config:** `export const maxDuration = 300` on `app/api/trace/reconstruct/route.ts` only; all other routes default. Fluid compute defaults on Hobby are sufficient — no queues, no cron in v1.
5. **README checklist:** clone → `npm install` → copy `.env.example` → `npm run db:generate && npx drizzle-kit migrate && npm run db:seed` → `npm run dev`; deploy = push to main with the two Neon URLs + `FDC_API_KEY` + `OFF_USER_AGENT` set.
6. **Vertical-slice acceptance:** open deployed URL on iPhone Safari → scan a seeded real UPC (e.g., Tony's 8-5900139-xxxxx) → identity renders < 1s from cache → checklist animates via polling → evidence-backed journey with at least one Verified/Documented, one Inferred (~70s), and one honest Unknown node.

**Verification notes:** pg_trgm/unaccent on Neon confirmed via [Neon extension docs](https://neon.com/docs/extensions/pg-extensions); Anthropic model IDs/pricing and structured-outputs/batch facts taken from the current claude-api reference (Opus 4.8 `claude-opus-4-8` $5/$25 per MTok, Batches at 50%); all other external claims trace to the verified research block provided with this task.