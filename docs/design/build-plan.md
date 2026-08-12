# Trace — mobile-first supply-chain scanner (final build plan)

## Context

Build **Trace**, a brand-new, polished, mobile-first web app deployed on Vercel. A user scans a US consumer product barcode (UPC/EAN, plus GS1 QR/DataMatrix) and sees a visual, step-by-step, **evidence-backed** reconstruction of the supply chain behind it — "Google Maps for a product's journey."

Non-negotiable product rule: **never fabricate supply-chain information.** Every rendered claim is backed by a persisted Evidence row or an explicitly labeled inference derived from evidence. Four statuses (Verified / Documented / Inferred / Unknown) + 0–100 confidence. Unknown is first-class; sparse-accurate beats rich-fictional.

Priority: a **working vertical slice** — open the deployed site on an iPhone, scan a real US UPC, resolve the product, see the strongest evidence-backed reconstruction.

Planning was done via a 7-agent research/design workflow (4 web-research agents verified every external fact against the live Aug-2026 ecosystem; 3 design agents produced full specs). Full design docs are saved at `/private/tmp/claude-501/-Users-eldw-Downloads-yn-web/0532dfec-299d-417f-8295-a3cdfddc271b/scratchpad/{design-architecture,design-data-seeds,design-ui-ux}.md` + `research.json` — **first implementation step copies them into the repo at `docs/design/`** so they survive this session. This plan is self-contained for execution; those docs add detail.

## Decisions locked with the user (2026-08-12)

- **GitHub**: public repo `theelinumbriel/trace` ("umbriel" account). `gh auth switch -u theelinumbriel` to create/push, then switch back to `elisadiopweyer`.
- **Database**: **Neon Postgres via Vercel Marketplace** (Vercel Postgres is sunset; Neon free tier: 0.5 GB, scale-to-zero, PostGIS available if ever needed). Attempt CLI provisioning; fall back to a one-click dashboard step.
- **Maps**: **Mapbox GL** — user has a Mapbox token (`NEXT_PUBLIC_MAPBOX_TOKEN`). Everything else keyless. No Anthropic key: LLM code paths ship but stay optional with deterministic fallbacks.
- Project dir: `/Users/eldw/Downloads/trace` (NOT inside yn-web). Vercel deploys via already-logged-in CLI (account `elisadiopweyer`, CLI 54.x) — no GitHub↔Vercel integration needed.

## Verified external constraints (all live-checked 2026-08-12)

- **Barcode**: native `BarcodeDetector` is unusable on iOS Safari (flag-only, broken since iOS 18); Android Chrome native needs GMS. → **Use the `barcode-detector@3.2.1` ponyfill unconditionally** (ZXing-C++ WASM; formats `upc_a, ean_13, ean_8, qr_code, data_matrix`); self-host the .wasm via `prepareZXingModule({overrides:{locateFile}})` (defaults to jsDelivr). GS1 AI parsing: `@valentynb/gs1-parser@2.0.0`; Digital Link URIs: `digital-link.js@1.4.3`.
- **iOS camera**: HTTPS-only getUserMedia, `playsinline` required, torch/zoom available (Safari 17.4+), no focus constraints. **Standalone PWAs re-prompt camera permission every launch** → PWA `start_url: "/"`, never `/scan`.
- **Haptics**: `navigator.vibrate` Android-only (iOS hack patched in iOS 26.5). iOS feedback = white flash + WebAudio tick.
- **Stack**: Next.js **16.3.0** stable (spec says 15+), React 19.2, Tailwind **v4.3** (no tailwind.config), shadcn CLI 4.x — init with **`npx shadcn@latest init -b radix`** (Base UI is the new default but its drawer dropped vaul; we need vaul snap-points). Zod **4.4.x**. Drizzle **drizzle-orm 0.45.2 + drizzle-kit 0.31.10** (v1 is still RC). Runtime driver `drizzle-orm/neon-http` + `@neondatabase/serverless`; seeds via `drizzle-orm/node-postgres` (needs real transactions).
- **Vercel Hobby**: fluid compute, 300s max duration, `after()` from `next/server` is stable. Caching: `"use cache"` + `cacheComponents: true` (unstable_cache deprecated); `revalidateTag`/`updateTag`.
- **Data sources** (live-tested): Open Food Facts **API v3** (`world.openfoodfacts.org/api/v3/product/{gtin}`; mandatory custom User-Agent; **15 read req/min/IP**; ODbL attribution + share-alike), USDA FDC (`/fdc/v1/foods/search` matching `gtinUpc`, 12-digit form; free key; CC0), openFDA enforcement (recalls; UPCs only as free text in `code_info`/`product_description`), UPCitemdb trial (keyless, 100/day, non-food fallback). **GS1 prefix→company and bills-of-lading have NO free API** → mock adapters (fixtures hand-seeded legally from GS1 US free web UI + citing public ImportYeti/Panjiva index pages).
- **Map**: react-map-gl v8.1.2 has a dedicated `/mapbox` entry point. (Design doc targeted MapLibre+OpenFreeMap; we adapt to Mapbox per user's token — same GeoJSON/line-gradient animation approach works on both, and Mapbox additionally has `line-trim-offset`.)
- Reverse geocoding for scan locality: **BigDataCloud free client-side endpoint** (keyless; must stay browser-side per its terms), coords rounded to 2 decimals before the call.

## Stack summary

Next.js 16.3 App Router · TypeScript · Tailwind v4 · shadcn/ui (Radix base) · Neon Postgres + Drizzle · Zod 4 · `barcode-detector` ponyfill · Mapbox GL (react-map-gl/mapbox) + @turf/great-circle · Geist Sans/Mono (`geist` npm pkg) · vaul drawer · vitest. PWA via `app/manifest.ts` (manifest-only; no offline precache in v1).

## Repo layout

```
trace/
├── app/
│   ├── layout.tsx / page.tsx          # shell + editorial home ("Where did this come from?")
│   ├── manifest.ts                    # PWA manifest (start_url "/")
│   ├── scan/page.tsx                  # full-viewport scanner
│   ├── search/page.tsx                # GET-form search (name/brand/GTIN)
│   ├── codes/page.tsx                 # printable/scannable test sheet of seeded barcodes
│   ├── product/[gtin]/
│   │   ├── layout.tsx                 # cached identity header + tab nav
│   │   ├── page.tsx | map/page.tsx | sources/page.tsx | not-found.tsx
│   └── api/
│       ├── products/lookup/route.ts               # POST raw scan value → identity
│       ├── products/[gtin]/route.ts               # GET identity + trace summary
│       ├── products/[gtin]/trace/route.ts         # GET trace + pipeline steps (polling target)
│       ├── products/[gtin]/sources/route.ts       # GET evidence cards
│       └── trace/reconstruct/route.ts             # POST → 202 + after() pipeline; maxDuration=300
├── components/  ui/ · shell/ · home/ · scan/ · product/ · trace/ · map/
├── lib/
│   ├── gtin.ts                        # normalize→GTIN-14 + check digit + GS1 AI parse
│   ├── confidence.ts (+ .test.ts)     # PURE deterministic scoring
│   ├── haptics.ts                     # vibrate on Android; flash+audio tick on iOS
│   ├── schemas/{domain,api}.ts        # Zod: all request/response contracts
│   ├── engine/{reconstruct,stages,paths,persist,serialize}.ts
│   ├── llm/{client,extract}.ts        # optional; null client without ANTHROPIC_API_KEY
│   └── errors.ts · http.ts
├── db/
│   ├── schema/ (enums, companies, facilities, products, materials, shipments,
│   │            events, evidence, claim-evidence, traces, scans, provider-fetches)
│   ├── client.ts                      # neon-http; PGlite fallback when DATABASE_URL unset (dev)
│   ├── json-types.ts · seed-schema.ts
│   ├── migrations/                    # drizzle-kit generate output, checked in
│   └── seed-data/*.json               # 7 products (below), same evidence model as live
├── providers/
│   ├── types.ts · registry.ts
│   ├── live/{open-food-facts,fdc,openfda-recalls,upcitemdb,curated-disclosures}.ts
│   └── mock/{gs1-company,bill-of-lading,epcis}.ts
├── scripts/seed.ts (+ gen-barcodes.ts for /codes)
├── docs/design/*.md                   # the three design docs, committed
├── drizzle.config.ts · next.config.ts · .env.example · README.md · vitest.config.ts
```

## Database schema (canonical decisions)

Use the data-design doc's schema (CHECK-constraint-enforced) with these reconciliations against the architecture doc:

- Tables: `companies` (slug natural key, parent_company_id, company_type enum), `facilities` (slug, nullable company_id — ports have none, facility_type enum, lat/lng `double precision`, `os_id` for Open Supply Hub, `unlocode` for ports), `products` (**gtin GTIN-14 unique**, upc12, brand/manufacturer FKs, `identity_evidence_id NOT NULL` — identity itself is a cited claim), `materials` + `product_materials` (origin claims with status/confidence checks), `shipments` (**`source_evidence_id NOT NULL`** — a shipment is unrepresentable without evidence), `supply_chain_events` (event_type enum, location_label, lat/lng, `status` claim_status enum, confidence 0–100, `evidence_summary NOT NULL`, `inference_basis` required iff inferred, optional `lot_code`), `evidence` (source_name/url/type, title, publisher, publication_date, retrieved_at, `supporting_text NOT NULL`, reliability_score, license, `needs_verification` flag), `claim_evidence` (FKs to event/shipment/product_material with `num_nonnulls(...)=1` CHECK), `traces` (kind product|batch, lot/serial/expiry, status `pending|running|complete|partial|failed`, `pipeline` jsonb checklist, `best_path` jsonb event-id[], `alt_paths`, `engine_version`, `sources_as_of`, `computed_at`; partial unique indexes: one product-trace per product, one batch-trace per (product,lot,serial)), `scans` (raw_value, symbology, ai_data jsonb, locality string, approx lat/lng rounded to 2dp — **precise coords never stored**), `provider_fetches` (per-provider TTL throttle).
- `claim_status` enum = `verified|documented|inferred|unknown`. **"Observed" is not an enum value** — the scan node renders from `scans` and is labeled Observed in the UI type only.
- DB-enforced bands (CHECK `events_band_ck`): verified 85–100, documented 70–94, inferred 1–84, unknown = 0. `inferred ⇒ inference_basis NOT NULL`; `unknown ⇒ confidence 0`.
- `source_type` enum (data-doc version, used by seeds + evidence cards): `product_database, manufacturer_disclosure, sustainability_report, certification, government_record, recall_database, customs_record, gs1_registry, traceability_system, news_media, retailer_listing, other`.
- Migration 0001 also runs `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` (fuzzy recall/company matching; both on Neon free).
- Insert-only discipline for evidence/events/shipments/claim_evidence: corrections are new rows.

**GTIN normalization (`lib/gtin.ts`)**: canonical key everywhere is zero-padded **GTIN-14**; validate GS1 mod-10 check digit; derive `upc12` for FDC. `/product/[gtin]` canonicalizes to GTIN-14. DataMatrix/QR: parse GS1 element string / Digital Link; **batch mode iff AI(10) lot or AI(21) serial present**.

## Evidence-integrity gates (four layers)

1. **DB constraints** (above — unrepresentable states).
2. **Write gate**: `lib/engine/persist.ts` is the ONLY module inserting events/edges; `persistEvent(event, evidenceIds)` throws if status ≠ unknown and evidenceIds is empty. LLM output has no other path into the graph. (Lint-greppable rule: `db.insert(supplyChainEvents)` appears only in persist.ts; CI grep test.)
3. **Read gate**: `lib/engine/serialize.ts` joins events→claim_evidence→evidence; any non-unknown event with zero surviving evidence rows is **demoted to unknown at render time** + logged. UI renders only from this serializer.
4. **Seed/CI assertions**: Zod `superRefine` on seed files (non-unknown ⇒ ≥1 evidence ref; unknown ⇒ confidence 0; inferred ⇒ basis) + post-insert SQL assertions inside the seed transaction.

## Provider adapter layer

Interfaces in `providers/types.ts`: `ProductLookupProvider`, `TradeDataProvider`, `FacilityProvider`, `TraceabilityProvider`, `RecallProvider` (fifth — recalls don't fit the others). All return `ProviderResult<T>` = ok/data/`observations: RawObservation[]` or typed error. **Every RawObservation is persisted as an evidence row (content-hash deduped) BEFORE any graph reasoning**; the engine works only from persisted evidence IDs.

| Adapter | Status | Notes |
|---|---|---|
| open-food-facts | **LIVE** | v3 endpoint, `User-Agent: ${OFF_USER_AGENT}` required; retries siblings (Products/Beauty/PetFood Facts hosts) |
| fdc | **LIVE** | search by `upc12`, verify `gtinUpc` match; `brandOwner` is the key provenance field |
| openfda-recalls | **LIVE** | brand/firm tokens + UPC free-text variants (raw + `d ddddd ddddd d` spaced) |
| upcitemdb | **LIVE** (demo-grade) | keyless trial, 100/day, last-resort non-food; `UPCITEMDB_ENABLED` flag |
| curated-disclosures | **LIVE (static)** | reads seeded evidence JSON (Oatly/Tony's/Patagonia/COR/Counter Culture reports, Open Supply Hub extract) |
| gs1-company | **MOCK** | GS1 US Data Hub shape; fixtures hand-seeded via free web UI (30 lookups/day, legal). Upgrade path documented ($500/yr API) |
| bill-of-lading | **MOCK** | ImportYeti/Panjiva record shape; mock rows only for seed products, UI-labeled "Illustrative — commercial data source not connected" |
| epcis | **MOCK** | EPCIS 2.0 events for one demo lot → real BATCH TRACE flow (Digital Link parsing itself is real) |

Registry with ordered chains (`productLookup: [OFF, fdc, gs1Mock, upcitemdb]`), `AbortSignal.timeout(4000)` per call, one 5xx retry, 429/503 marks provider rate-limited (skip). `provider_fetches` TTLs (OFF 24h, FDC 7d, openFDA 24h, UPCitemdb 7d) keep us under OFF's 15 req/min via server-side proxying.

## Reconstruction engine

`reconstructSupplyChain(traceId)` in `lib/engine/reconstruct.ts`. Pipeline steps (each transactionally updates `traces.pipeline` for the live checklist): `identify → manufacturer → origins → facilities → trade → recalls → route` (+ internal finalize). A stage finding nothing marks itself done and inserts an **unknown gap event** (confidence 0, explicit uncertainty note) where the chain needs a hop — never a guessed placeholder.

- **Edges** are proposed only by registered rules over persisted evidence: same-document co-mention, shipment record, corporate ownership, or an explicitly registered inference rule (e.g. `infer:eu-us-ocean`, always status=inferred). Every edge stores rule id + contributing evidence ids.
- **Path ranking**: deterministic — path score = min(edge confidence), tie-break mean → fewer inferred hops → lexicographic. Edges <50 excluded from primary path (gap becomes unknown); up to 2 alternates in `traces.alt_paths` jsonb.
- **Batch traces** never fabricate item-level provenance: product-level bestPath + any lot-matching events (v1's only generator: openFDA lot text match). Zero lot hits ⇒ header states "No lot-specific records found; showing the product-level chain."
- **Orchestration on Vercel**: `POST /api/trace/reconstruct` → fresh-trace TTL check (`TRACE_TTL_HOURS`, default 168 — never re-run inside TTL) → claim the canonical trace row via conditional update (concurrency-safe) → return `202 {traceId}` immediately → run pipeline in **`after()`** (route `maxDuration = 300`; expected wall time 10–40s). Stuck `running` >5 min = crashed; next kick restarts.
- **Progressive UI = DB-persisted step states + client polling** (decided over SSE: fluid-compute polling is ~free; iOS kills streams on backgrounding — polling resumes losslessly on `visibilitychange`; reload-safe because state lives in Postgres). Poll `GET /api/products/[gtin]/trace` every 1.2s while pending/running, backoff to 10s on network failure.

## Confidence model (`lib/confidence.ts` — pure, deterministic, unit-tested)

`scoreClaim(evidence[], inferredDepth, asOf) → {confidence, status, breakdown}`:

1. Per-evidence weight `w = BASE[sourceType] × recency × SPEC[specificity]`. BASE: traceability_system .97, gs1_registry .93, government_record .90, recall_database .88, manufacturer_disclosure .86, sustainability_report/certification .84, customs_record .78, product_database .60, news_media .55, retailer_listing/other .50. Recency `max(0.6, 0.5^(ageYears/halfLife))` (missing date → 0.8). SPEC: exact_item 1.0, exact_product .95, brand_level .85, company_level .70.
2. Corroboration: group by source domain, `max(w)` within group, noisy-OR across groups (`1 − Π(1−w_g)`) — same publisher never stacks.
3. Inference penalty: `× 0.85^inferredDepth`.
4. Status mapping consistent with the DB bands: **verified** requires direct-traceability class OR ≥2 independent primary sources, conf ≥85 (direct class cap 100); **documented** = responsible-party documentation, 70–94 (cap 94); **inferred** 1–84 (primary path requires ≥50, `inference_basis` required); **unknown** = no evidence, 0. `breakdown` is persisted and rendered verbatim in the evidence drawer ("Why we think this") — no unexplainable numbers.

Unit tests: per-type single-source values, no same-domain stacking, noisy-OR monotonicity, depth penalty, band boundaries (49/50/69/70/84/85/94/95), determinism, seed-rubric compatibility.

## API routes (Zod 4 everywhere; error envelope `{error:{code,message,retryable}}`)

- `POST /api/products/lookup` — `{code (raw digits | GS1 element string | Digital Link URI), locality?}` → identity + mode (product|batch) + batch AIs; inserts `scans` row; `404 NO_MATCH` / `422 INVALID_BARCODE`.
- `GET /api/products/[gtin]` — cached identity + trace summary.
- `GET /api/products/[gtin]/trace` — trace + `pipeline` steps + events (grows as stages complete) — polling target, fully dynamic.
- `GET /api/products/[gtin]/sources` — evidence cards + claims each supports.
- `POST /api/trace/reconstruct` — `{gtin, mode, lot?, force? (non-prod only)}` → `202 {traceId}` / `200 {fresh:true}`.

## Caching (three layers, DB is truth)

1. Postgres: traces never recomputed inside TTL; `provider_fetches` throttles upstream (= OFF rate-limit compliance).
2. Next `"use cache"` (cacheComponents: true): `getProductIdentity(gtin)` tagged `product:${gtin}` (`cacheLife("days")`), completed-trace reads tagged `trace:${gtin}` (`cacheLife("hours")`); `revalidateTag` on finalize. No `unstable_cache`.
3. HTTP: `/api/products/[gtin]` + `/sources` get `s-maxage=300, stale-while-revalidate=86400`; lookup/trace/reconstruct fully dynamic.

## Scanner UX (`/scan`)

Full-viewport camera (`h-dvh`, black theme-color on this route), framing reticle, copy "Scan a product barcode / Point your camera at a UPC, EAN, QR, or GS1 code". `useScanner` hook: getUserMedia (`facingMode: environment`, `playsinline`), `barcode-detector` ponyfill detect loop on rAF, torch toggle when `track.getCapabilities().torch`, duplicate-scan debounce (same value in 5s ignored), stream rebuild on `visibilitychange`/`pageshow`, tracks stopped on unmount. On detect: freeze frame + 120ms white flash + reticle contract, mono chip with digits, `haptics.tick()`, then push `/product/[gtin]` (with `?lot=` if GS1 AIs parsed — "Batch data detected" micro-chip). Error states (all with manual-entry escape hatch): permission denied (platform-specific re-enable steps), unsupported/no camera (desktop path: inline manual entry + seeded example chips), invalid checksum (shake + retry), offline (toast + retry). Manual entry: vaul drawer (mobile) / dialog (desktop), numeric input, paste-friendly, Zod + mod-10 validation.

## Map tab (Mapbox adaptation — the one deliberate change from the design docs)

- `mapbox-gl` v3 (latest) + `react-map-gl@8.1.2` `/mapbox` entry; style `mapbox://styles/mapbox/light-v11` (light, editorial); token `NEXT_PUBLIC_MAPBOX_TOKEN` (README: URL-restrict it in the Mapbox dashboard). Client-only via `next/dynamic` `ssr:false` wrapper.
- Routes: `@turf/great-circle` arcs (128 pts), single GeoJSON source `lineMetrics: true`; base layer all legs thin ink @18% opacity; verified/documented legs animate sequentially via line-gradient head advanced in ONE rAF loop (~900ms/leg, staggered); **inferred legs are a separate dashed amber layer** that fades in on its turn (solid = on record, dashed = inference). Loop pauses on `visibilitychange`; `prefers-reduced-motion` renders static.
- Markers: numbered circles matching timeline indices (ink = verified/documented, amber outline = inferred, dashed gray = unknown-at-region-centroid with "approx." note, pulsing dot = scan). Click → `?event=NN` + event card → EvidenceDrawer. `map.resize()` on tab entry; single map instance; pixelRatio capped at 2; `map.remove()` on unmount (iOS WebGL memory).
- Fallbacks: WebGL2 absent, style/tile failure, or missing token → `MapUnavailable` ordered location list with status glyphs (all information, no theatre). Antimeridian: test a cross-dateline arc (known turf v7.3.2+ regression); pin/split if broken.

## UI design system (from design-ui-ux.md — implement as specced)

- **Type**: Geist Sans + Geist Mono (`geist@^1.7`, next/font, self-hosted). Two-register system: prose in Sans, data (GTINs, %, dates, ports, node indices "01") in Mono with tabular numerals. Scale tokens `text-display` (clamp ~2.75–5.5rem hero) → `text-micro` (uppercase +0.08em).
- **Color** (Tailwind v4 `@theme`, light-only v1, `color-scheme: light`): paper `#FAF9F6`, ink `#161513`, meta gray `#6F6B64`, hairline `#E7E4DE`, wash `#F1EFEA`, verified green `#1E7A4A`, inferred amber `#9A6200`, danger (recalls only) `#B3261E`. **Green is scarce by policy** (glyphs + counts only — the anti-eco-app rule). Elevation = 1px borders, not shadows (single shadow token for drawer).
- **Status grammar** (never color-only; glyph + label + confidence): ✓ solid green circle Verified · ✓ outlined ink circle Documented · ◐ half-filled amber Inferred (+ "· 78%" inline) · ? dashed circle Unknown · ● pulsing ink dot Observed. Hand-rolled `StatusGlyph`. Timeline connector: solid 1px between verified/documented, dashed when either endpoint inferred/unknown.
- **Screens**: Home (hero "Where did this come from?", scan CTA, enter-barcode secondary, example-trace card rail from seed data incl. the sparse Great Value water to set expectations); `/scan`; `/search` (GET form, ILIKE name/brand + exact GTIN); product page with sticky header (image, brand/name/category, **PRODUCT TRACE / BATCH TRACE mode badge** with tooltip, trust summary "✓ 2 verified · ◐ 2 inferred · ? 1 unknown") + URL-driven tab nav (Journey | Map | Sources — real routes, not shadcn Tabs).
- **Journey tab**: `TraceProgress` live checklist while running (✓/●/○ items collapsing into the timeline as stages resolve), then `JourneyTimeline` — left rail with mono index + glyph + connecting line, big location names (`text-title-2`), status line, date + "N sources" in mono; rows are ≥56px buttons → EvidenceDrawer. **Unknown nodes get equal visual weight**: dashed-outline card, "**We don't know.** No public record links…" + "What would resolve this: …".
- **EvidenceDrawer**: vaul bottom sheet `< md` (snap 0.62/0.97), `Sheet side="right"` ≥ md. Order: header glyph+title, ConfidenceMeter (2px bar, ticks at 50/70/85/95, band label), "Why we think this" prose (inferred opens "**Inferred.** No direct record documents this step. Based on:"), evidence cards (source name, type badge, published+retrieved dates in mono, quoted supporting_text with 2px ink left border, "View source ↗"), and an **always-present uncertainty statement** (amber-bordered for inferred; scope note for verified: "Verified for this product type, not this specific unit.").
- **Sources tab**: grouped by claim (per event, with matching index/glyph), source cards + dataset attributions footer (OFF ODbL, FDC CC0, openFDA, OSH CC-BY-SA — legally required).
- **shadcn install**: `button badge card input label drawer sheet dialog skeleton separator alert tooltip sonner scroll-area spinner empty item`. Hand-rolled: StatusGlyph, JourneyTimeline, ConfidenceMeter, EvidenceDrawer composition, TraceProgress, ScannerViewport/Reticle/useScanner, RouteMap, ModeBadge/TrustSummary/TabNav, ResponsiveModal, LocalityExplainer.
- **A11y**: status triple-encoded, AA contrast, `aria-live` scan announcements, focus-trapped drawers, reduced-motion coverage.

## Scan location (optional, privacy-first)

Never prompt on load. Final timeline node renders "Location off · **Add your area?**" → explainer modal ("We use your approximate area only — like 'Upper East Side, New York'. Exact coordinates never stored.") → on accept: geolocate, **round to 2 decimals client-side**, BigDataCloud client-side reverse geocode → locality string only (localStorage + `scans.locality`; server Zod re-rounds coords as defense). Denial is a normal path.

## Mobile polish & PWA

`viewport-fit=cover`; hand-rolled `@utility` safe-area classes (Tailwind v4 has no built-ins — verified); `100dvh` everywhere (never 100vh); ≥44px touch targets (56px timeline rows); `overscroll-behavior-y: none` on /scan + map. `lib/haptics.ts`: `tick()` vibrate(35), `success()` [20,40,20] — Android only, no-op + flash/audio-tick on iOS. `app/manifest.ts`: standalone, `start_url: "/"`, 192/512 + maskable icons, apple-touch-icon 180; on iOS standalone /scan shows a one-time dismissible note about per-launch camera prompts; manifest-only (no service worker/offline precache in v1).

## Error handling matrix (summary — full table in docs/design/design-architecture.md §8)

Invalid barcode → 422 inline; no match → 404 editorial state (+ scan persisted as coverage signal); provider timeout → chain continues, stage gap = unknown event, trace `partial` with "Some sources were unreachable" banner; rate-limited → same as timeout; client offline → cached identity + polling backoff + resume; duplicate scan → debounce client-side, canonical-trace-row collapse server-side; pipeline crash → stale-running detection + retry affordance; LLM failure → template summary, never fails trace.

## Seed dataset — 7 real products (UPCs live-verified 2026-08-12 against OFF/FDC/UPCitemdb)

| # | Product | UPC-A | Texture |
|---|---|---|---|
| 1 | Counter Culture **Big Trouble** 12oz (coffee) | `663505002063` | Documented origin program + roastery (Durham NC); Inferred import; port Unknown |
| 2 | **Tony's Chocolonely** Milk 32% 6.35oz (chocolate) | `858010005580` | Richest chain: Documented Ghana/Côte d'Ivoire coops (FAIR Report) → Documented Wieze Belgium factory (Barry Callebaut partnership) → **Inferred 78** Rotterdam→Newark (public ImportYeti/Panjiva index pages cited; matches the spec's example shape) → Inferred 64 distribution |
| 3 | **California Olive Ranch** 100% CA EVOO (olive oil) | `850687110505` | All-domestic Documented chain — proves engine doesn't hallucinate ports |
| 4 | **Bob's Red Mill** Rolled Oats 16oz (packaged food) | `039978001542` | **Unknown crop origin front and center**; Documented Milwaukie OR mill |
| 5 | **Oatly** Original Oatmilk 64oz (beverage) | `190646641016` | Documented candidate set of 3 NA plants, honestly unresolved instance |
| 6 | **Patagonia** P-6 Logo Tee (clothing) | `888336749295` | Documented cotton program; **Unknown factory** (supplier list ≠ product mapping); Inferred import |
| 7 | **Great Value** Purified Water (sparse demo) | `078742351926` | 2 of 3 stages Unknown; Documented Walmart brand ownership (GS1 registry fixture) |

Each seed JSON carries real evidence rows (source name/URL/type/date/**verbatim supporting_text ≥20 chars**/reliability/license) — key docs: Tony's Annual FAIR Report 2024/25, Barry Callebaut partnership PR, ImportYeti+Panjiva public pages, Counter Culture Transparency Report 2025, COR 100%-California line pages, Oatly sustainability PDF + investor PRs + Ya Ya Foods co-packer coverage, Bob's Red Mill FDC record + Wikipedia, Patagonia factories page (**needs_verification: true** — site anti-bot on 2026-08-12) + May-2020 supplier XLSX (staleness expressed via low reliability score), OFF records for all food items. Full per-product stage plans + URLs in `docs/design/design-data-seeds.md` §4.

Batch demo: synthetic clearly-labeled element string `(01)00858010005580(10)TRACE-DEMO(17)270601` rendered as DataMatrix on `/codes` — exercises BATCH TRACE honestly ("No lot-specific records found"). `/codes` also renders all 7 UPC-A barcodes as SVGs for on-device scan testing.

Seeds flow through `SeedFileSchema` + the same `persistEvent` gate + one transaction + post-insert SQL assertions; a seeded trace (`engine_version: "seed-1"`) is indistinguishable from a live one at render — one render path, one integrity gate.

## LLM boundaries (optional; no key provided — ships dormant)

`lib/llm/client.ts` returns null without `ANTHROPIC_API_KEY`; every call site has a deterministic fallback (regex extraction; `lower(unaccent(trim()))`+pg_trgm normalization; template evidence summaries). With a key: ingest-time extraction (structured outputs w/ verbatim-quote guard: extracted tuples must pass `sourceText.includes(quote)`), classification, finalize-stage summary prose. **The LLM never mints graph edges** — persistEvent's evidence-ID requirement is the mechanical guarantee. SDK `@anthropic-ai/sdk`, `ANTHROPIC_MODEL` default `claude-opus-4-8`.

## .env.example

```bash
DATABASE_URL=                # Neon pooled (auto-injected by Vercel marketplace integration)
DATABASE_URL_UNPOOLED=       # Neon direct — drizzle-kit migrate
OFF_USER_AGENT="Trace/0.1 (you@example.com)"   # REQUIRED by Open Food Facts
FDC_API_KEY=DEMO_KEY         # free at api.data.gov; DEMO_KEY works (30/hr)
OPENFDA_API_KEY=             # optional (1k/day → 120k/day)
UPCITEMDB_ENABLED=true
NEXT_PUBLIC_MAPBOX_TOKEN=    # user-supplied; URL-restrict in Mapbox dashboard
ANTHROPIC_API_KEY=           # optional; app fully functional without
ANTHROPIC_MODEL=claude-opus-4-8
TRACE_TTL_HOURS=168
```

Dev fallback: `db/client.ts` uses **PGlite** (`drizzle-orm/pglite`, file-backed `./.pglite/`) when `DATABASE_URL` is unset, so `npm install && npm run dev` + seed work with zero provisioning; hosted Neon for deploy.

## Implementation order

1. **Bootstrap**: `npx create-next-app@latest trace` (TS, Tailwind, App Router, no src dir) in `~/Downloads`; commit; copy design docs → `docs/design/`; `gh auth switch -u theelinumbriel` → `gh repo create theelinumbriel/trace --public --source . --push` → switch back. `vercel link` under elisadiopweyer.
2. **Design system**: Geist fonts, `@theme` tokens, safe-area utilities, shadcn init `-b radix` + component adds, StatusGlyph, shell (header/footer), Home skeleton.
3. **DB**: full Drizzle schema + enums + CHECKs, migrations, client (neon-http/PGlite switch), json-types, gtin.ts (+ tests).
4. **Seeds**: seed-schema, 7 seed JSONs (real evidence; re-verify the 2 `needs_verification` URLs; hand-run GS1 US web lookups for prefixes 0078742/0858010/0190646 → gs1 fixtures), seed.ts with transaction + assertions, `/codes` barcode sheet.
5. **Providers**: types/registry/http helper, 5 live + 3 mock adapters, provider_fetches throttling.
6. **Engine**: confidence.ts (+ full unit-test suite), persist.ts write gate, serialize.ts read gate, stages, paths, reconstruct + after() orchestration.
7. **API**: 5 routes with Zod schemas + error envelope + caching headers/tags.
8. **Product UI**: layout/header/tabs, Journey timeline + TraceProgress polling + EvidenceDrawer, Sources tab, not-found, error/loading/empty states.
9. **Map tab**: Mapbox route map + animation + marker sync + fallbacks.
10. **Scanner + search + home finish**: useScanner + all error states + manual entry; search page; example-trace rail; locality flow (BigDataCloud); haptics.
11. **PWA + polish**: manifest, icons, meta theme-color per route, reduced-motion, a11y pass.
12. **Provision + deploy**: Neon via Vercel marketplace (CLI attempt, else 1-click dashboard step — may need user), env vars (needs the user's **Mapbox token**), `npm run build` (`drizzle-kit migrate && next build`), seed Neon, `vercel --prod`, README (setup, deploy, data-source credits, upgrade paths for commercial APIs).
13. **Verify end-to-end** (below), then final commit/push.

Each milestone ends with a commit; push to theelinumbriel/trace throughout.

## Verification

- **Unit**: vitest — confidence bands/monotonicity/determinism, gtin normalization + check digits + GS1 AI parsing (incl. GS-separator survival test for `(01)(10)(17)` DataMatrix), serializer demotion gate.
- **Integrity**: seed run must pass in-transaction SQL assertions (no non-unknown event without evidence; best_path resolves; URLs parse); CI-style grep that `db.insert(supplyChainEvents)` exists only in persist.ts.
- **Static**: `tsc --noEmit`, `next lint`, `npm run build`.
- **API smoke** (local, seeded): curl lookup/identity/trace/sources for a seeded GTIN + an unknown GTIN (404 path) + an invalid checksum (422 path); POST reconstruct twice → second returns fresh/202-collapse.
- **Live reconstruction**: POST reconstruct for a real non-seeded food UPC (e.g. any OFF-known product) → verify identity resolves, pipeline completes, and the trace is *honest* (mostly Unknown + product_database identity evidence — the negative-space test that nothing is fabricated).
- **On-device (user)**: deployed URL on iPhone Safari + Android Chrome → scan seeded UPCs from `/codes` (screen or printed) and a real pantry item; camera permission denied path; torch; batch DataMatrix demo; map animation; geolocation locality flow. I'll provide a test checklist in the README.
- **Deploy checks**: Vercel prod build green, migrations applied, seeded data present, OFF User-Agent set, Mapbox token restricted.

## Open items that may need the user mid-build

1. **Mapbox token value** (they have one) — needed at step 12 (map works locally only after it's in `.env`; I'll build the MapUnavailable fallback first so nothing blocks).
2. **Neon marketplace provisioning** — if the Vercel CLI can't create the integration non-interactively, a one-click dashboard step (I'll provide the exact link); PGlite keeps local dev/seed/test unblocked meanwhile.
