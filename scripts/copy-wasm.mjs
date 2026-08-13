// Self-host the ZXing WASM binary (barcode-detector fetches it from
// jsDelivr by default — a scanner that depends on a third-party CDN is a
// scanner that breaks). Runs on postinstall.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.join(
  process.cwd(),
  "node_modules",
  "zxing-wasm",
  "dist",
  "reader",
  "zxing_reader.wasm",
);
const outDir = path.join(process.cwd(), "public", "wasm");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, path.join(outDir, "zxing_reader.wasm"));
console.log("copied zxing_reader.wasm → public/wasm/");
