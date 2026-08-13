# Trace

**Where did this come from?** Scan a US product barcode and see a visual,
step-by-step, evidence-backed reconstruction of the supply chain behind it.

Trace never fabricates supply-chain information. Every rendered claim is
backed by a persisted evidence row or an explicitly labeled inference derived
from evidence; **Unknown is a first-class state**, shown with the same visual
weight as everything else. A sparse accurate trace beats a rich fictional one.

## Quick start

```bash
npm install
npm run db:migrate   # applies migrations (PGlite locally — zero provisioning)
npm run db:seed      # loads 7 real products with real, cited evidence
npm run dev
```

Open http://localhost:3000. No accounts or keys are needed for local dev:
without `DATABASE_URL` the app runs on a file-backed [PGlite](https://pglite.dev)
database in `./.pglite`. The Map tab needs `NEXT_PUBLIC_MAPBOX_TOKEN`
(it degrades to a located-stages list without one).

> PGlite is single-process: stop the dev server before running
> `npm run db:seed`, then start it again. (Irrelevant with hosted Postgres.)

Visit **/codes** for scannable barcodes of every seeded product — open it on
one screen and scan with your phone.

## The two trace modes

- **PRODUCT TRACE** — a UPC/EAN identifies a product *type*. The trace shows
  the best-supported chain for that type, never claims about your unit.
- **BATCH TRACE** — when a scanned GS1 DataMatrix/QR/Digital Link carries a
  lot (AI 10) or serial (AI 21), Trace runs item-level lookups on top of the
  product chain. With no lot-specific records it says exactly that.
  `/codes` includes a synthetic, clearly-labeled demo DataMatrix.

## Evidence model

Four statuses with DB-enforced confidence bands
(`verified` 85–100 · `documented` 70–94 · `inferred` 1–84 · `unknown` 0):

1. **DB constraints** make sourceless claims unrepresentable
   (`shipments.source_evidence_id NOT NULL`, band CHECKs, inference-basis
   CHECK).
2. **Write gate** — `lib/engine/persist.ts` is the only module that inserts
   events/evidence links and refuses any non-unknown claim without evidence.
   CI-greppable: `scripts/check-integrity-gate.sh`.
3. **Read gate** — `lib/engine/serialize.ts` demotes any sourced-looking
   event with zero surviving evidence rows to Unknown at render time.
4. **Seed assertions** — seed files are Zod-validated and re-asserted in SQL
   inside the load transaction.

Confidence is a pure, deterministic function
(`lib/confidence.ts`): per-source weights × recency decay × specificity,
noisy-OR corroboration across independent publishers, ×0.85 per inference
hop, class caps. The full breakdown renders in the evidence drawer.

## Data sources

| Source | Status | Notes |
|---|---|---|
| Open Food Facts (v3) | **live** | identity; ODbL — attribution in footer + evidence cards |
| USDA FoodData Central | **live** | UPC→brand owner; CC0; free key (`DEMO_KEY` works) |
| openFDA enforcement | **live** | recalls, surfaced only on UPC text match |
| UPCitemdb (trial) | **live** | non-food fallback, 100/day, TTL-throttled |
| Curated disclosures | **live (static)** | Oatly/Tony's/Patagonia/COR/Counter Culture documents, cited in seeds |
| GS1 company prefix | **mock** | no free API since GEPIR retired; fixtures hand-checkable via the free GS1 US web UI; upgrade path: GS1 US Data Hub API (~$500/yr) |
| Bills of lading | **mock** | ImportYeti/Panjiva/ImportGenius are commercial-only; mock rows are UI-labeled "Illustrative" and exist only where public index pages show the lane |
| EPCIS / Digital Link | **mock (empty)** | the code path is real; fabricated item provenance is not |

Provider adapters live in `providers/` behind typed interfaces; swapping a
mock for a commercial API means implementing one module. Upstream calls are
TTL-throttled through the `provider_fetches` table (OFF 24h, FDC 7d), which
is also how Open Food Facts' 15 req/min limit is respected.

## Deploy (Vercel + Neon)

1. `vercel link` (already linked as `emdw/trace` for this repo).
2. **Neon**: accept marketplace terms once in the browser —
   https://vercel.com/emdw/~/integrations/accept-terms/neon — then:
   ```bash
   vercel integration add neon -n trace-db
   ```
   This provisions the free tier and injects `DATABASE_URL` +
   `DATABASE_URL_UNPOOLED` into the project.
3. Set the remaining env vars:
   ```bash
   vercel env add OFF_USER_AGENT production      # "Trace/0.1 (you@example.com)"
   vercel env add FDC_API_KEY production          # or DEMO_KEY
   vercel env add NEXT_PUBLIC_MAPBOX_TOKEN production
   ```
4. Deploy + seed:
   ```bash
   vercel --prod                                  # vercel-build runs migrations
   vercel env pull .env.production.local
   DATABASE_URL=$(grep ^DATABASE_URL= .env.production.local | cut -d= -f2-) npm run db:seed
   ```

The build command on Vercel is `vercel-build` (`drizzle-kit migrate &&
next build`); local `npm run build` never touches a database.

## On-device test checklist (iPhone Safari / Android Chrome)

- [ ] Open the deployed URL → hero renders, example traces rail present
- [ ] `/scan` → camera permission prompt → live view with reticle
- [ ] Scan a code from `/codes` on another screen → freeze + flash + chip →
      product page renders identity instantly → checklist animates →
      journey timeline with Verified/Documented, Inferred (with %), and
      honest Unknown nodes
- [ ] Tap a node → evidence drawer: confidence meter, "Why we think this",
      real source links, uncertainty statement
- [ ] Map tab → light basemap, sequential route animation, dashed amber for
      inferred legs, marker → drawer
- [ ] Sources tab → every document with publisher/date/excerpt/link
- [ ] Scan the demo DataMatrix → "Batch data detected" → BATCH TRACE badge →
      "No lot-specific records found"
- [ ] Deny camera permission → recovery instructions + manual entry
- [ ] Scan a real pantry UPC not in the seeds → live reconstruction: honest,
      mostly-Unknown trace (identity + gaps, no fabrication)
- [ ] Journey's last node → "Add your area?" → approximate locality only
- [ ] Android: haptic tick on detect; torch button if the device has one
- [ ] Add to Home Screen → standalone app opens on the homepage

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | vitest (GTIN, confidence model) |
| `npm run db:generate` / `db:migrate` | drizzle-kit schema → SQL → DB |
| `npm run db:seed` (`-- --reset`) | transactional seed with integrity assertions |
| `bash scripts/check-integrity-gate.sh` | write-gate grep |
| `node scripts/gen-icons.mjs` · `npx tsx scripts/gen-barcodes.ts` | regenerate icons / test barcodes |

## Stack

Next.js 16 (App Router, cacheComponents/PPR) · TypeScript · Tailwind v4 ·
shadcn/ui (Radix) · Drizzle ORM · Neon Postgres (PGlite dev fallback) ·
Zod 4 · `barcode-detector` ponyfill (self-hosted ZXing WASM) · Mapbox GL +
react-map-gl · @turf/great-circle · Geist.

## Credits

Product data: [Open Food Facts](https://openfoodfacts.org) (ODbL),
[USDA FoodData Central](https://fdc.nal.usda.gov) (CC0),
[openFDA](https://open.fda.gov), [UPCitemdb](https://upcitemdb.com).
Facility data: [Open Supply Hub](https://opensupplyhub.org) (CC BY-SA 4.0).
Corporate disclosures are cited per-claim inside the app.
