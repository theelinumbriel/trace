import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Test barcodes",
  description:
    "Scannable barcodes for every seeded product — open on one screen, scan with your phone.",
};

const CODES = [
  { upc: "663505002063", gtin: "00663505002063", slug: "counter-culture-big-trouble", label: "Counter Culture Big Trouble", category: "Coffee" },
  { upc: "858010005580", gtin: "00858010005580", slug: "tonys-milk-32", label: "Tony's Chocolonely Milk 32%", category: "Chocolate" },
  { upc: "850687110505", gtin: "00850687110505", slug: "california-olive-ranch-100ca", label: "California Olive Ranch 100% CA EVOO", category: "Olive oil" },
  { upc: "039978001542", gtin: "00039978001542", slug: "bobs-red-mill-rolled-oats", label: "Bob's Red Mill Rolled Oats", category: "Packaged food" },
  { upc: "190646641016", gtin: "00190646641016", slug: "oatly-original-64oz", label: "Oatly Oatmilk The Original", category: "Beverage" },
  { upc: "888336749295", gtin: "00888336749295", slug: "patagonia-p6-logo-tee", label: "Patagonia P-6 Logo Tee", category: "Clothing" },
  { upc: "078742351926", gtin: "00078742351926", slug: "great-value-purified-water", label: "Great Value Purified Water", category: "Sparse-trace demo" },
];

export default function CodesPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 md:px-8">
      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        Testing
      </p>
      <h1 className="mt-2 text-title-1 text-ink">Scannable test codes</h1>
      <p className="mt-3 max-w-md text-meta text-ink-2">
        Every seeded product, as a real UPC-A barcode. Open this page on one
        screen and scan it with your phone at{" "}
        <span className="text-mono-data">/scan</span> — or tap a card to jump
        straight to its trace.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CODES.map((c) => (
          <Link
            key={c.upc}
            href={`/product/${c.gtin}`}
            className="rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-ink"
          >
            <p className="text-micro font-medium uppercase tracking-widest text-meta">
              {c.category}
            </p>
            <p className="mt-1 text-body font-medium text-ink">{c.label}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/codes/${c.slug}.svg`}
              alt={`UPC-A barcode ${c.upc}`}
              className="mt-3 h-24 w-full bg-white object-contain p-2"
            />
            <p className="mt-2 text-center text-mono-data text-meta">{c.upc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-dashed border-hairline bg-wash p-5">
        <p className="text-micro font-medium uppercase tracking-widest text-meta">
          Batch trace demo
        </p>
        <p className="mt-2 text-meta text-ink-2">
          A <strong>synthetic, clearly-labeled</strong> GS1 DataMatrix carrying
          the Tony&apos;s GTIN plus lot{" "}
          <span className="text-mono-data">TRACE-DEMO</span> and an expiry
          date. Scanning it demonstrates BATCH TRACE handling — the app will
          honestly report that no lot-specific records exist. No item-level
          provenance is ever synthesized.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/codes/batch-demo-datamatrix.svg"
          alt="Synthetic GS1 DataMatrix: (01)00858010005580(10)TRACE-DEMO(17)270601"
          className="mx-auto mt-4 h-40 w-40 bg-white p-3"
        />
        <p className="mt-2 text-center text-mono-data text-meta">
          (01)00858010005580(10)TRACE-DEMO(17)270601
        </p>
      </div>
    </div>
  );
}
