# Trace — UI/UX & Design System Specification (v1)

**Scope**: design system, screen-by-screen UI spec, scan-location UX, mobile polish, state matrix, shadcn/ui inventory. Backend/data/reconstruction are referenced only where the UI contract touches them. All package versions verified against the Aug 2026 ecosystem research and live web checks.

---

## 0. Decisions at a glance

| Decision | Choice | One-line rationale |
|---|---|---|
| Typeface | **Geist Sans + Geist Mono** (`geist@^1.7.0` npm pkg, bundled via next/font) | Söhne-adjacent grotesque, free (OFL), variable, first-party Next.js packaging, ships a mono sibling for the "technical" register |
| Dark mode | **Light-only v1**, semantic tokens kept dark-ready | The product identity *is* the off-white paper; Positron basemap is light; halves QA surface |
| shadcn primitive base | **Radix** (`npx shadcn@latest init -b radix`) | Spec mandates a vaul bottom sheet; the Base UI drawer (default since Jul 2026) dropped vaul and is weeks old |
| Tabs | **URL-driven links**, not shadcn `Tabs` | `/product/[gtin]`, `/map`, `/sources` are real routes per spec; back button and sharing must work |
| Evidence drawer | **vaul Drawer** (snap points) `< md`, **Sheet** (side panel) `≥ md` | Exactly the spec's mobile/desktop split |
| Status colors | Verified green `#1E7A4A`, Inferred amber `#9A6200`, Documented = ink, Unknown = gray + dashed | Only two hues on the page; never color-only (glyph + label always) |
| Haptics | `navigator.vibrate(35)` Android-only; iOS gets ink flash + WebAudio tick | iOS switch-haptic hack is dead as of iOS 26.5 (verified) |
| Safe areas | Hand-rolled `@utility` classes | Tailwind v4.3 still has **no built-in** safe-area utilities (verified — still a GitHub proposal) |
| PWA | `app/manifest.ts`, `display: "standalone"`, `start_url: "/"` — **not** `/scan` | iOS standalone re-prompts camera every launch; don't make the broken path the front door |

---

## 1. Design system

### 1.1 Typography

**Primary: Geist Sans. Data register: Geist Mono.** Install `geist` (v1.7.x on npm), which wraps both in `next/font` (self-hosted, zero external requests — PWA/CSP-safe, no CLS).

```ts
// app/layout.tsx
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

<html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
```

**Why Geist over Inter / Instrument Sans:**
- It is the closest free Söhne-adjacent grotesque: tight apertures, low contrast, slightly condensed caps — reads "Linear/Bloomberg terminal", not "SaaS default". Inter at display sizes reads generic-product; Instrument Sans is warmer/rounder than the museum-catalogue register we want.
- Ships a matched mono. Trace's identity depends on a **two-register system**: prose in Sans, *data* (GTINs, confidence %, dates, ports, coordinates) in Mono. That mono-for-provenance-metadata move is what makes the page feel like a catalogue record instead of an eco-app.
- Variable font, tabular figures available (`font-variant-numeric: tabular-nums` on all numeric UI).
- A serif display face (Instrument Serif, Newsreader) was considered for the hero and **rejected**: a third family buys ambience but costs coherence and bytes; the editorial feel comes from scale, tracking, and whitespace instead.

**Type scale** (Tailwind v4 `@theme` tokens; 16px root):

| Token | Size / line-height | Tracking | Use |
|---|---|---|---|
| `text-display` | `clamp(2.75rem, 8.5vw, 5.5rem)` / 0.98 | −0.035em | Home hero only |
| `text-title-1` | 1.75rem / 1.15 | −0.02em | Product name |
| `text-title-2` | 1.25rem / 1.3 | −0.01em | Timeline node location, section heads |
| `text-body` | 1rem / 1.6 | 0 | Prose, "Why we think this" |
| `text-meta` | 0.8125rem / 1.5 | 0 | Metadata gray text, evidence card fields |
| `text-micro` | 0.6875rem / 1.2 | +0.08em, uppercase | Status labels, mode badge, eyebrow labels |
| `text-mono-data` | 0.8125rem, `font-mono`, tabular | +0.01em | GTIN, confidence %, dates, node index |

Timeline node indices ("01", "02") render in Mono at `text-title-2` size — the signature typographic element.

### 1.2 Color tokens

Warm off-white paper, near-black ink, one green, one amber. Everything else is grayscale. All pairs meet WCAG AA on paper (`ink` ~15:1, `ink-2` ~7:1, `meta` ~5:1, `verified` ~4.9:1, `inferred` ~5:1).

```css
/* app/globals.css — Tailwind v4, no tailwind.config file */
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  /* Surfaces & ink */
  --color-paper: #FAF9F6;        /* page background */
  --color-surface: #FFFFFF;      /* cards, drawer */
  --color-ink: #161513;          /* primary text */
  --color-ink-2: #55524C;        /* secondary text */
  --color-meta: #6F6B64;         /* metadata gray */
  --color-hairline: #E7E4DE;     /* 1px borders */
  --color-wash: #F1EFEA;         /* skeleton, inset panels */

  /* Evidence statuses */
  --color-verified: #1E7A4A;
  --color-verified-tint: #E9F1EB;
  --color-inferred: #9A6200;
  --color-inferred-tint: #F5EDDD;
  --color-unknown: #8B867D;      /* glyphs/dashes only; unknown text uses meta */
  --color-danger: #B3261E;       /* recalls only */

  /* shadcn semantic mapping */
  --color-background: var(--color-paper);
  --color-foreground: var(--color-ink);
  --color-card: var(--color-surface);
  --color-muted: var(--color-wash);
  --color-muted-foreground: var(--color-meta);
  --color-border: var(--color-hairline);
  --color-primary: var(--color-ink);
  --color-primary-foreground: var(--color-paper);
  --color-ring: var(--color-ink);

  --radius: 0.625rem;

  --text-display: clamp(2.75rem, 8.5vw, 5.5rem);
  --text-display--line-height: 0.98;
  --text-display--letter-spacing: -0.035em;
  /* …remaining scale tokens per table above */
}

html { color-scheme: light; }
```

**Status system** (the core visual grammar — status is always *glyph + label + (conditionally) confidence*, never color alone):

| Status | Glyph (16px inline SVG) | Color | Timeline treatment |
|---|---|---|---|
| Verified | ✓ in solid green circle | `verified` | Solid 1px connecting line |
| Documented | ✓ in outlined ink circle | `ink` | Solid 1px connecting line |
| Inferred | ◐ half-filled circle | `inferred` | Dashed 1px connecting line + `NN%` in mono |
| Unknown | ? in dashed circle | `unknown` | Dashed line, dashed-outline card |
| Observed (your scan) | ● solid ink dot, one-time pulse | `ink` | Terminal node |

Confidence display rule: **percentage shown inline on the timeline only for Inferred** (e.g. "Inferred · 78%"); all statuses show the exact number inside the evidence drawer on a 2px confidence bar with tick marks at 50 / 70 / 85 / 95 (the deterministic bands), the active band labeled ("Strong combination of independent records").

Green is *scarce by policy*: verified glyphs, verified counts, nothing else. No green buttons, no green backgrounds larger than a badge. This is the single strongest anti-"eco-app" rule.

### 1.3 Spacing, radii, elevation

- 4px base grid. Page gutters: 20px mobile / 32px tablet / max-w-2xl centered column for Journey & Sources (map is full-bleed).
- Section rhythm: 48px mobile / 72px desktop between major blocks. Whitespace is the layout.
- Radii: `--radius` 10px (buttons, inputs), 12px cards, 16px drawer top corners, 2px status bars.
- **Elevation: borders, not shadows.** 1px `hairline` everywhere; a single shadow token `shadow-[0_8px_30px_rgba(22,21,19,0.08)]` reserved for the drawer, popovers, and the sticky scan result chip.

### 1.4 Dark mode: light-only in v1

Justification: (a) the off-white/ink editorial identity is the brand — dark mode is a second brand, not a toggle; (b) the OpenFreeMap Positron basemap is light; a credible dark map means adopting/tuning `fiord` or `dark` plus re-validating both status hues for contrast — real work with zero v1 user value; (c) evidence-status colors were contrast-tuned against paper; (d) halves the QA matrix on the two mandated targets (iPhone Safari, Android Chrome). Guardrails so it stays cheap later: components consume only semantic tokens (never raw hexes), `color-scheme: light` set explicitly so iOS doesn't auto-darken form controls, `<meta name="theme-color" content="#FAF9F6">` (and `#000000` on `/scan` via per-route metadata, since the camera view is black).

### 1.5 Motion

Durations 150ms (micro) / 250ms (standard) / 400ms (reveal); easing `cubic-bezier(0.22, 1, 0.36, 1)`. All non-essential motion gated behind `@media (prefers-reduced-motion: no-preference)`. Signature moments (the complete list — nothing else animates):
1. Scan detect: freeze-frame + 120ms white flash + reticle contracts 4%.
2. Timeline reveal: nodes stagger in 60ms apart, translate-y 8px + fade (on first load only).
3. Checklist ticks: ○ → ● pulse → ✓, per progress event.
4. Map route draw: sequential line-gradient head animation (see §3.5).
5. Drawer: vaul's native spring.

### 1.6 Icons

`lucide-react` (installed by shadcn) at 16/20px, `stroke-width={1.5}` globally — thinner strokes read editorial. Status glyphs are **not** lucide; they are a hand-rolled `<StatusGlyph>` (5 fixed SVGs) so the four statuses are visually ownable and print-stable.

```ts
// components/trace/status-glyph.tsx
export type TraceStatus = "verified" | "documented" | "inferred" | "unknown" | "observed";
export function StatusGlyph({ status, size = 16, withLabel = false }:
  { status: TraceStatus; size?: 16 | 20 | 24; withLabel?: boolean }): JSX.Element;
```

---

## 2. Tailwind v4 + shadcn setup

```bash
npx shadcn@latest init -b radix        # Radix base: keeps the vaul drawer; mature ecosystem
```

`components.json`: `"style": "new-york"`, `"tailwind": { "css": "app/globals.css", "config": "", "cssVariables": true }`, `"iconLibrary": "lucide"`. Do not mix Base UI components in later — one primitive base per app.

Hand-rolled utilities in `globals.css` (Tailwind v4 still lacks built-ins for safe areas — verified Aug 2026):

```css
@utility pt-safe { padding-top: env(safe-area-inset-top); }
@utility pb-safe { padding-bottom: env(safe-area-inset-bottom); }
@utility pb-safe-4 { padding-bottom: calc(env(safe-area-inset-bottom) + 1rem); }
@utility h-dvh-full { height: 100dvh; }
@utility no-scrollbar { scrollbar-width: none; &::-webkit-scrollbar { display: none; } }
```

---

## 3. Screen-by-screen specification

### 3.0 App shell — `app/layout.tsx`

```
RootLayout (server)
├─ <html className={fonts}> <body class="bg-paper text-ink antialiased">
├─ SiteHeader                      components/shell/site-header.tsx
│   ├─ Wordmark "Trace" (link /)   — text-micro tracking-widest uppercase, ink
│   ├─ <Link /search> Search icon
│   └─ <Button size="sm"> Scan     — ink-filled pill, hidden on /scan
├─ {children}
├─ SiteFooter                      — attribution block (§3.7)
└─ <Toaster position="top-center"> (sonner)
```

Viewport export: `{ width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FAF9F6" }`. Header is `sticky top-0`, paper background, 1px hairline bottom, `pt-safe`. Hidden entirely on `/scan` (immersive).

### 3.1 Home — `app/page.tsx` (server component)

```
HomePage
├─ Hero                              components/home/hero.tsx
│   ├─ eyebrow: "SCAN ANY US BARCODE" (text-micro, meta)
│   ├─ h1 "Where did this come from?" (text-display, max-w-[14ch])
│   ├─ sub: "Point your camera at a barcode. Trace reconstructs the product's
│   │        journey from evidence — and tells you what it doesn't know." (ink-2)
│   └─ actions row
│       ├─ <Button size="lg" asChild><Link href="/scan">  "Scan a barcode"  (ink fill, camera icon)
│       └─ <Button size="lg" variant="outline" onClick={openManualEntry}>  "Enter a number"
├─ ExampleTraces                     components/home/example-traces.tsx (server, DB query)
│   ├─ section head: "Example traces" + "From our seed catalogue" (meta)
│   └─ horizontal snap-scroll rail (mobile) / 3-col grid (≥lg)
│       └─ ExampleTraceCard ×4–6    components/home/example-trace-card.tsx
│           ├─ product image (1:1, hairline border, bg-wash)
│           ├─ brand (text-micro uppercase meta) + name (text-title-2)
│           ├─ route line: "Sweden → Landskrona → Newark" (text-meta, mono arrows)
│           ├─ status counts: "✓ 2 verified · ◐ 2 inferred · ? 1 unknown" (glyphs at 12px)
│           └─ GTIN in mono-data
└─ HowItWorks                        — 3 short columns: Scan / Resolve / Reconstruct,
                                       + one honest paragraph on the evidence model
                                       ("If we can't prove a step, we say Unknown.")
```

Example cards come from the seeded DB via the same trace-summary query as the product page (spec: seed data not hardcoded in components). Include at least one card whose summary shows an Unknown-dominant trace — honesty is a homepage feature.

### 3.2 Scanner — `app/scan/page.tsx`

Server page renders metadata + `<ScannerScreen />`; `components/scan/scanner-screen.tsx` is a `"use client"` wrapper doing `dynamic(() => import("./scanner-viewport"), { ssr: false })`. Detection uses `barcode-detector/ponyfill` unconditionally (per research recommendation), formats `["upc_a","ean_13","ean_8","qr_code","data_matrix"]`, `detect(videoEl)` on a rAF loop throttled to ~10fps.

```
ScannerViewport ("use client")          components/scan/scanner-viewport.tsx
├─ <video playsinline muted autoplay>   absolute inset-0 object-cover, h-dvh-full
├─ FreezeCanvas                         hidden until detect; drawImage frame grab
├─ Reticle                              components/scan/reticle.tsx (hand-rolled)
│    — centered rounded rect ~78vw × 44vw (16:9-ish for 1D codes), four 2px corner
│      strokes in white/90, outside dimmed rgba(10,10,9,0.45) via SVG mask;
│      idle: corners "breathe" ±3% at 2.4s; reduced-motion: static
├─ StatusCopy (aria-live="polite")      below reticle, white text on scrim
├─ TopBar (pt-safe)                     X close (left) · TorchButton (right, only if
│                                       track.getCapabilities().torch)
└─ BottomBar (pb-safe-4)                <Button variant="secondary"> "Type it instead"
                                        → ManualEntrySheet
```

**State machine** (`useScanner` hook, `components/scan/use-scanner.ts`):

| State | UI |
|---|---|
| `requesting` | Paper full-screen (not black): camera glyph, "Trace needs your camera to read barcodes. Nothing is recorded." + Continue button → `getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } } })` |
| `scanning` | Copy "Scan a product barcode"; after 6s idle append hint "Move closer — fill the frame with the barcode" |
| `detected` | Freeze frame; white flash 120ms; reticle contracts; mono chip with decoded digits slides up; `haptics.tick()`; after 350ms `router.push(/product/${gtin})` |
| `denied` | Full-screen explainer: "Camera access is off." + platform steps (iOS Safari: "Tap aA in the address bar → Website Settings → Camera → Allow"; Android Chrome: "Tap the lock icon → Permissions → Camera") + "Type it instead" CTA. Never re-call getUserMedia in a loop |
| `unsupported` / no camera (desktop) | Centered card: "No camera here." + ManualEntryForm inline + "Try an example" row of seed-GTIN chips (mono) that link straight to product pages — this is the desktop testing path |
| `invalid` | Barcode read but checksum fails: chip shakes 200ms, copy "That code didn't read cleanly — try again", auto-return to `scanning` |
| network fail on navigate | sonner toast "You're offline — we'll retry", Retry action |

Rules: duplicate-scan guard (same GTIN within 5s ignored); rebuild the stream on `visibilitychange`/`pageshow` (iOS kills backgrounded streams); stop all tracks on unmount. If a scanned DataMatrix/QR parses GS1 AIs via `@valentynb/gs1-parser` (AI 01 + 10/17), push `/product/${gtin}?lot=${lot}` and show a "Batch data detected" micro-chip during the freeze.

**ManualEntrySheet** — `components/scan/manual-entry.tsx`. vaul `Drawer` on `< md`, `Dialog` on `≥ md` (shared responsive wrapper `components/ui/responsive-modal.tsx`). One `<Input inputMode="numeric" autoComplete="off">`, paste-friendly (strips spaces/dashes), Zod: `z.string().transform(s => s.replace(/\D/g,"")).pipe(z.string().regex(/^(\d{8}|\d{12,14})$/))` + mod-10 check digit; error copy under field: "That doesn't look like a valid barcode number. Check the digits printed under the bars." Submit → same navigation path as a scan.

### 3.3 Search — `app/search/page.tsx`

Server component reading `searchParams.q`; queries local products (name/brand ILIKE + GTIN exact with leading-zero normalization). Plain form (GET) — URL-driven, shareable, desktop-friendly; no Command palette in v1.

```
SearchPage
├─ <form> <Input name="q" autoFocus placeholder="Name, brand, or barcode number" />
├─ Results (Suspense boundary)
│   └─ ResultRow ×n (shadcn Item)     — thumb 48px · name (body, medium) · brand + category
│                                       (meta) · GTIN (mono-data) · status-count glyphs · chevron
├─ Empty (q, no hits): shadcn Empty — "No matches for '4012...'" +
│     "Scan it instead" button + "If it's a valid UPC we'll build its trace on first scan."
└─ Loading: 6 skeleton rows (thumb square + two lines)
```

### 3.4 Product page — `app/product/[gtin]/`

```
app/product/[gtin]/
├─ layout.tsx        server: fetch identity (cached), render header + tab nav, {children}
├─ page.tsx          Journey tab
├─ map/page.tsx      Map tab
├─ sources/page.tsx  Sources tab
└─ not-found.tsx     unresolvable GTIN
```

**ProductHeader** — `components/product/product-header.tsx` (server):

```
├─ image 96px sq (hairline border, bg-wash; fallback: barcode glyph on wash)
├─ brand (text-micro uppercase meta) · name (text-title-1) · category (text-meta)
├─ ModeBadge                          components/product/mode-badge.tsx
│    "PRODUCT TRACE" | "BATCH TRACE" — text-micro mono, 1px ink border, 2px radius;
│    BATCH adds lot chip "LOT 8841 · EXP 03/2027" (mono). Tooltip on tap/hover explains
│    the mode ("Type-level: the best-supported chain for this product, not your item.")
├─ TrustSummary: "✓ 2 verified · ✓ 1 documented · ◐ 2 inferred · ? 1 unknown" (12px glyphs)
└─ TabNav                             components/product/tab-nav.tsx (hand-rolled, <Link>s)
     Journey | Map | Sources · 12  — active: ink + 2px ink underline; inactive: meta;
     sticky under SiteHeader; usePathname() for active state; prefetch all three
```

**Journey tab** — `page.tsx` renders cached trace immediately if present; else streams progress.

*TraceProgress* — `components/trace/trace-progress.tsx` (client). Shown only while reconstruction is running (SSE from `/api/products/[gtin]/trace` if streaming; else 1.5s polling — component consumes a `TraceProgressEvent[]` prop either way):

```
"Tracing this product" (text-title-2)
✓ Product identified          — ink check (process state, NOT evidence green)
✓ Manufacturer found
● Looking for origin data     — pulsing ink dot
○ Searching trade records     — hairline circle
○ Building route
```

Completed items collapse into the revealed timeline top-down; timeline nodes appear as their stages resolve (progressive reveal per spec).

*JourneyTimeline* — `components/trace/journey-timeline.tsx` (client, hand-rolled — this is the product's centerpiece; no shadcn analogue):

```ts
export interface TimelineNodeVM {
  eventId: string;
  index: number;                 // renders "01"
  title: string;                 // "Ocean freight"
  locationPrimary: string;       // "Gothenburg → Newark"  (text-title-2)
  locationSecondary?: string;    // "Port of Gothenburg, SE" (text-meta)
  status: TraceStatus;
  confidence: number;            // 0–100
  dateRange?: string;            // "Mar–Apr 2026" (mono-data)
  evidenceCount: number;         // "3 sources"
}
export function JourneyTimeline({ nodes, onSelect }:
  { nodes: TimelineNodeVM[]; onSelect: (eventId: string) => void }): JSX.Element;
```

Layout: left rail 40px — mono index above `StatusGlyph`, vertical 1px connecting line between nodes (solid for verified/documented→next, dashed `4 4` when either endpoint is inferred/unknown). Right: title (meta, uppercase micro), location (title-2), status line "Verified" / "Inferred · 78%" / "Documented" in status color, date + evidence count in mono meta. Entire row is a ≥56px tap target (`<button>`), chevron-right at 40% opacity; tap → EvidenceDrawer.

*Unknown node* (first-class, per spec): same index + rail position; dashed 1px outline card on `wash`; title e.g. "Origin of cocoa butter"; body: "**We don't know.** No public record links this ingredient to a specific origin for this product." + "What would resolve this: supplier disclosure or import records naming the manufacturer." (text-meta). No confidence number. It occupies the same visual weight as known stages — sparse-accurate over rich-fictional, rendered literally.

*EvidenceDrawer* — `components/trace/evidence-drawer.tsx`:

```ts
export function EvidenceDrawer({ event, open, onOpenChange }:
  { event: TraceEventDetailVM | null; open: boolean; onOpenChange: (o: boolean) => void });
```

`< md`: vaul `Drawer`, `snapPoints={[0.62, 0.97]}`, rounded-t-2xl, drag handle, `pb-safe`. `≥ md`: `Sheet side="right"` w-[420px]. Content order:
1. Header: `StatusGlyph 24` + stage title + location (title-2).
2. ConfidenceMeter (hand-rolled): 2px bar, ticks at 50/70/85/95, mono "78 / 100", band label "Reasonable inference from sourced evidence".
3. "Why we think this" (text-micro eyebrow) + reasoning paragraph (body). For inferred: opens with "**Inferred.** No direct record documents this step. Based on:".
4. Evidence cards (`components/trace/evidence-card.tsx`): source name (medium) · source-type Badge (outline; one of `Manufacturer disclosure · Government record · Open database · Trade record · Certification · Direct traceability`) · published + retrieved dates (mono-data) · quoted `supporting_text` (2-line clamp, wash background, 2px ink left border) · "View source ↗" external link (underlined, opens new tab).
5. Uncertainty statement: always present. Amber 2px left border for inferred ("Alternative routes via Baltimore are consistent with the same records."), gray for unknown, and for verified a short scope note ("Verified for this product type, not this specific unit." on PRODUCT TRACE).

**Not-found** — `not-found.tsx`: barcode glyph on wash, "We couldn't identify this barcode." + mono GTIN echo + "Valid code, but no product data in any source we query." + buttons: Scan again / Search by name. If identity resolved but trace pipeline failed: render header normally + shadcn `Alert` in Journey tab ("We couldn't build a trace right now" + Retry button re-invoking reconstruction).

### 3.5 Map tab — `app/product/[gtin]/map/page.tsx`

Server page passes trace geometry to `components/trace/route-map-shell.tsx` (`"use client"`) which `dynamic(() => import("./route-map"), { ssr: false })`. `route-map.tsx`: `@vis.gl/react-maplibre` `Map` with `maplibre-gl@^6.3` (`setWorkerUrl` once at module top), `mapStyle="https://tiles.openfreemap.org/styles/positron"` (config-var so the Protomaps fallback is a swap).

- Full-bleed under the tab bar, `height: calc(100dvh - headerStack)`; `map.resize()` on tab entry; single map instance, `pixelRatio` capped at 2, `map.remove()` on unmount (iOS memory).
- **Markers**: numbered 24px circles matching timeline indices — ink fill/paper text for verified/documented, paper fill/amber border+text for inferred, dashed-border gray for unknown-location (rendered at region centroid with "approx." tooltip), pulsing ink dot for the scan location.
- **Routes**: `@turf/great-circle` arcs (npoints 128), one GeoJSON source, `lineMetrics: true`. Base layer: all legs, `line-width` 1.25, ink at 18% opacity. Animation overlay: verified/documented legs animate via `line-gradient` `["step",["line-progress"], inkColor, t, "rgba(0,0,0,0)"]` with `t` advanced in one rAF loop, staggered per leg (sequential reveal, ~900ms/leg). **Inferred legs do not use the gradient head** (line-gradient + dasharray is unsupported in MapLibre): they are a separate dashed amber layer (`line-dasharray [2,3]`, 60% opacity) that fades in (opacity transition) when its turn arrives — the honest visual: solid ink = on record, dashed amber = our inference. Loop pauses on `visibilitychange`; reduced-motion renders all legs static.
- **Selection sync**: marker click sets `?event=03` (replaceState) and opens a bottom event card (mobile: compact card above `pb-safe` — title, status, confidence, "View evidence" → EvidenceDrawer; desktop: opens the side panel directly). Deep links with `?event=` fly to and select that marker.
- Legend chip (bottom-left, above attribution): "— on record  - - inferred". Attribution control kept (OpenFreeMap requirement, auto-injected).
- **Fallback**: WebGL2 absent or style fails → `MapUnavailable` panel: "The map can't load on this device." + ordered plain list of locations with status glyphs (all information, no theatre).

### 3.6 Sources tab — `app/product/[gtin]/sources/page.tsx`

Server-rendered. Grouped by claim (spec): each `SupplyChainEvent` is a section — left rail shows the matching mono index + glyph for visual continuity with Journey; header "03 · Ocean freight, Gothenburg → Newark · Inferred". Under it, `SourceCard` per evidence row: publisher (medium) · title (body) · category Badge · published date + retrieved date, both mono ("Published Mar 2026 · Retrieved 08 Aug 2026") · "Supports 2 claims" (meta) · "View source ↗". Cards with dead links render the link struck-through with "Link unavailable — retrieved copy on file". Footer of the tab: dataset attributions (Open Food Facts ODbL + link, USDA FDC CC0 citation line, openFDA disclaimer, Open Supply Hub CC BY-SA) — legally required and on-brand for a provenance product.

### 3.7 Footer — `components/shell/site-footer.tsx`

Hairline top border; "Trace" wordmark; one-line evidence-model statement ("Every step is sourced or labeled as an inference. Unknowns are shown, not filled in."); attribution links; "Data sources" anchor to the sources documentation section on Home.

---

## 4. Scan-location UX

Principle: **never prompt on load; ask in context; store locality strings only.**

1. The Journey timeline's final node initially renders: `● Your scan` — "Location off · **Add your area?**" (link-styled button).
2. Tap → `LocalityExplainer` (`components/trace/locality-explainer.tsx`, ResponsiveModal): "**Complete the last mile.** Trace can end this journey at your neighborhood. We use your approximate area only — like 'Upper East Side, New York'. Your exact coordinates are never stored or sent to our servers." Buttons: "Use my area" / "Not now".
3. On accept: `navigator.geolocation.getCurrentPosition` → round lat/lng to 2 decimals (~1.1 km) → client-side call to `https://api.bigdatacloud.net/data/reverse-geocode-client?...&localityLanguage=en` (keyless, must stay browser-side per its fair-use terms) → node updates to `● Your scan · Upper East Side, New York · Observed`, and the map gains the pulsing scan marker.
4. Persist only the locality string in `localStorage("trace.locality")`; reuse silently on later scans with a one-time toast "Using your saved area — change in the last step." Geolocation denial is a normal path: node stays "Your scan", no nagging, the entry point remains available.

---

## 5. Mobile polish

- **Safe areas**: `viewport-fit=cover`; header `pt-safe`; scan top/bottom bars and all drawers `pb-safe`/`pb-safe-4`; map legend offset above the home indicator.
- **Viewport units**: `100dvh` (`h-dvh-full`) everywhere full-height; never `100vh` (iOS toolbar jump).
- **Touch targets**: ≥44×44px minimum, timeline rows ≥56px full-width; tab links get 12px invisible padding; torch/close buttons 44px with 24px glyphs.
- **Scroll**: `overscroll-behavior-y: none` on `/scan` and inside the map; vaul handles body-scroll locking for drawers; horizontal card rail uses `scroll-snap-type: x mandatory` + `no-scrollbar`.
- **Haptics** — `lib/haptics.ts`:

```ts
export const haptics = {
  tick(): void,     // scan detected — vibrate(35)
  success(): void,  // trace complete — vibrate([20, 40, 20])
};
```

Feature-detect `"vibrate" in navigator` and call inside the user-gesture-derived rAF loop (Chrome requires gesture provenance). On iOS: no-op — the checkbox-switch hack is patched as of iOS 26.5 — feedback is the white flash + a 30ms 1kHz WebAudio tick (AudioContext unlocked on the "Continue" tap in the camera pre-prompt). Never gate any flow on haptic confirmation.

- **PWA** — `app/manifest.ts` (native `MetadataRoute.Manifest`): `name: "Trace"`, `short_name: "Trace"`, `description`, `display: "standalone"`, `start_url: "/"`, `background_color: "#FAF9F6"`, `theme_color: "#FAF9F6"`, icons 192/512 + `purpose: "maskable"` variants, plus `<link rel="apple-touch-icon">` 180×180. No Serwist/offline precache in v1 (scanner is useless offline anyway) — the hand-rolled minimal SW from the official Next guide only if install prompt requires it on target Androids; otherwise ship manifest-only.
- **Installed behavior of `/scan`**: `start_url` is `/`, not `/scan`, because iOS standalone re-prompts camera permission on every launch (open WebKit bug). Detect `matchMedia("(display-mode: standalone)")` + iOS UA on `/scan` and render a one-time dismissible inline note above the bottom bar: "iOS asks for camera permission each time you open the installed app. For one-tap scanning, use Trace in Safari." No install promotion UI on iOS at all; Android may keep the browser-default install prompt.

---

## 6. State matrix (every screen)

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Home | Static (server-rendered); card rail streams via Suspense with 3 card skeletons (image square + 3 lines on `wash`) | Seed DB empty (dev only): rail hidden | — |
| /scan | `requesting` paper screen (§3.2) | — | denied / unsupported / invalid / offline — all specified in §3.2; every error state includes the manual-entry escape hatch |
| /search | 6 skeleton rows | `Empty` component + scan CTA + explanation | Query failure: `Alert` "Search is unavailable" + Retry |
| Product header | Skeleton: 96px square + two text lines (in `layout.tsx` Suspense) | — | GTIN unresolvable → `not-found.tsx` |
| Journey | TraceProgress checklist (not a skeleton — the checklist *is* the loading state, per spec) | Trace complete but zero stages: single Unknown-style card "We identified this product but found no supply-chain evidence yet." + Sources link (identity sources still shown) | Pipeline failure: header + `Alert` + Retry; stale cached trace shown beneath with "From {date}" chip if available |
| Map | `wash` panel + `Spinner` + "Preparing map" | No geocodable stages: MapUnavailable-style list with copy "Not enough located evidence to draw a route." | Style/tile failure → swap to Protomaps fallback style once, then MapUnavailable panel; WebGL2 absent → MapUnavailable |
| Sources | 3 source-card skeletons | "No public sources yet for this product." + explanation of what Trace queries | Fetch failure: `Alert` + Retry |
| Evidence drawer | Content passed in-memory (no spinner); if detail fetch needed: 3-line skeleton inside drawer | Unknown stages show the uncertainty template, never "no data" | Load failure inside drawer: inline retry row |
| Global | — | — | Offline banner (thin, ink on `wash`, top of viewport) when `navigator.onLine` false: "Offline — showing saved data"; sonner toasts for transient failures; `app/error.tsx` full-page: wordmark + "Something broke on our side." + Reload |

---

## 7. shadcn/ui inventory

**Install (exact):**

```bash
npx shadcn@latest init -b radix
npx shadcn@latest add button badge card input label drawer sheet dialog \
  skeleton separator alert tooltip sonner scroll-area spinner empty item
```

18 components. Usage map: `button` (all CTAs) · `badge` (source types, mode chips fallback) · `card` (evidence/source/example cards) · `input`+`label` (manual entry, search) · `drawer` (vaul: evidence drawer mobile, manual entry mobile) · `sheet` (evidence side panel desktop) · `dialog` (manual entry desktop) · `skeleton` · `separator` · `alert` (trace/search failures) · `tooltip` (mode badge, torch) · `sonner` (toasts) · `scroll-area` (drawer internals) · `spinner` (map preparing) · `empty` (search/sources empties) · `item` (search result rows).

**Deliberately not installed**: `tabs` (URL-driven nav, hand-rolled `TabNav`), `command` (plain search v1), `progress` (checklist is custom), `accordion`, `carousel` (CSS snap rail), `form` (two tiny forms; Zod + inline errors), `table`, `avatar`, `chart`.

**Hand-rolled (own these — they are the product):**

| Component | Path | Why not shadcn |
|---|---|---|
| `StatusGlyph` | `components/trace/status-glyph.tsx` | Bespoke evidence grammar |
| `JourneyTimeline` / `TimelineNode` | `components/trace/journey-timeline.tsx` | No timeline primitive exists; centerpiece |
| `ConfidenceMeter` | `components/trace/confidence-meter.tsx` | Banded tick bar is domain-specific |
| `EvidenceDrawer` / `EvidenceCard` | `components/trace/` | Composition of drawer/sheet + domain layout |
| `TraceProgress` | `components/trace/trace-progress.tsx` | Live checklist with glyph states |
| `ScannerViewport`, `Reticle`, `TorchButton`, `useScanner` | `components/scan/` | Camera + detection loop, fully custom |
| `RouteMap` + markers + animation loop | `components/trace/route-map.tsx` | MapLibre imperative layer work |
| `ModeBadge`, `TrustSummary`, `TabNav` | `components/product/` | Trivial but brand-specific |
| `ExampleTraceCard`, `Hero` | `components/home/` | Editorial layout |
| `ResponsiveModal` | `components/ui/responsive-modal.tsx` | Drawer-below-md / Dialog-above wrapper |
| `LocalityExplainer` | `components/trace/locality-explainer.tsx` | Privacy UX copy + geolocation flow |

**UI-relevant packages beyond shadcn**: `geist`, `lucide-react` (via shadcn), `vaul` (via shadcn drawer), `barcode-detector@^3.2.1`, `@valentynb/gs1-parser@^2.0.0`, `maplibre-gl@^6.3.0`, `@vis.gl/react-maplibre@^8.1.2`, `@turf/great-circle@^7.4.0`, `zod@^4.4.3`, `sonner` (via shadcn).

---

## 8. Accessibility commitments (v1, non-negotiable)

- Status is always triple-encoded: glyph shape + text label + color. Confidence always available as text.
- All text tokens meet WCAG AA on `paper` (§1.2); `meta` gray reserved for ≥13px text.
- `/scan` status copy in `aria-live="polite"`; detect announcement "Barcode 041303001165 detected. Loading product."
- Drawer/sheet focus-trapped (Radix/vaul default); timeline nodes are `<button>`s with `aria-expanded`; map markers have keyboard-focusable list fallback (the MapUnavailable list doubles as the SR path via visually-hidden rendering).
- Full `prefers-reduced-motion` coverage: no stagger, no route animation (routes render complete), no reticle breathing.

Sources: [shadcn — July 2026: Base UI as the Default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) · [shadcn Base UI Drawer (vaul dropped in base variant)](https://ui.shadcn.com/docs/components/base/drawer) · [shadcn components index (76 components incl. Spinner/Empty/Item)](https://ui.shadcn.com/docs/components) · [geist on npm (v1.7, geist/font/sans)](https://www.npmjs.com/package/geist) · [Vercel Geist font](https://vercel.com/font) · [Next.js font optimization](https://nextjs.org/docs/app/getting-started/fonts) · [vaul snap points](https://vaul.emilkowal.ski/snap-points) · [vaul on npm](https://www.npmjs.com/package/vaul/v/1.0.0) · [Tailwind safe-area built-in proposal (still open)](https://github.com/tailwindlabs/tailwindcss/discussions/20200) · [tailwindcss-safe-area community plugin](https://github.com/mvllow/tailwindcss-safe-area)