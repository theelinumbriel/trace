/**
 * Generates scannable SVG barcodes for the seeded products into
 * public/codes/, plus the clearly-labeled synthetic GS1 DataMatrix used to
 * demo BATCH TRACE. Run: npx tsx scripts/gen-barcodes.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import bwipjs from "bwip-js/node";

const OUT = path.join(process.cwd(), "public", "codes");

const UPCS: { upc: string; slug: string; label: string }[] = [
  { upc: "663505002063", slug: "counter-culture-big-trouble", label: "Counter Culture Big Trouble" },
  { upc: "858010005580", slug: "tonys-milk-32", label: "Tony's Chocolonely Milk 32%" },
  { upc: "850687110505", slug: "california-olive-ranch-100ca", label: "California Olive Ranch 100% CA EVOO" },
  { upc: "039978001542", slug: "bobs-red-mill-rolled-oats", label: "Bob's Red Mill Rolled Oats" },
  { upc: "190646641016", slug: "oatly-original-64oz", label: "Oatly Oatmilk The Original" },
  { upc: "888336749295", slug: "patagonia-p6-logo-tee", label: "Patagonia P-6 Logo Tee" },
  { upc: "078742351926", slug: "great-value-purified-water", label: "Great Value Purified Water" },
];

/**
 * Synthetic demo lot — clearly labeled, never presented as real provenance.
 * (01) GTIN of the Tony's bar, (10) lot TRACE-DEMO, (17) expiry 2027-06-01.
 */
const DEMO_DATAMATRIX = "(01)00858010005580(10)TRACE-DEMO(17)270601";

function main() {
  mkdirSync(OUT, { recursive: true });

  for (const { upc, slug } of UPCS) {
    const svg = bwipjs.toSVG({
      bcid: "upca",
      text: upc,
      includetext: true,
      textxalign: "center",
      height: 18,
    });
    writeFileSync(path.join(OUT, `${slug}.svg`), svg);
    console.log(`wrote ${slug}.svg`);
  }

  const dm = bwipjs.toSVG({
    bcid: "gs1datamatrix",
    text: DEMO_DATAMATRIX,
  });
  writeFileSync(path.join(OUT, "batch-demo-datamatrix.svg"), dm);
  console.log("wrote batch-demo-datamatrix.svg");
}

main();
