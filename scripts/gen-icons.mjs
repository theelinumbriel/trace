// Generates the app icon set from an inline SVG (the scan-reticle motif on
// paper). Outputs: public/icon-192.png, public/icon-512.png, maskable
// variants, app/icon.png, app/apple-icon.png.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const icon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad > 0 ? 0 : 96}" fill="#FAF9F6"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <g stroke="#161513" stroke-width="26" stroke-linecap="round" fill="none">
      <path d="M118 172 v-28 a26 26 0 0 1 26 -26 h28"/>
      <path d="M340 118 h28 a26 26 0 0 1 26 26 v28"/>
      <path d="M394 340 v28 a26 26 0 0 1 -26 26 h-28"/>
      <path d="M172 394 h-28 a26 26 0 0 1 -26 -26 v-28"/>
    </g>
    <g fill="#161513">
      <rect x="176" y="216" width="14" height="80" rx="4"/>
      <rect x="210" y="216" width="26" height="80" rx="4"/>
      <rect x="256" y="216" width="14" height="80" rx="4"/>
      <rect x="290" y="216" width="8" height="80" rx="4"/>
      <rect x="318" y="216" width="20" height="80" rx="4"/>
    </g>
  </g>
</svg>`;

function render(svg, size) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  }).render().asPng();
}

const pub = path.join(process.cwd(), "public");
mkdirSync(pub, { recursive: true });

writeFileSync(path.join(pub, "icon-192.png"), render(icon(0), 192));
writeFileSync(path.join(pub, "icon-512.png"), render(icon(0), 512));
// Maskable: safe-zone padding so the mark survives circular masks.
writeFileSync(path.join(pub, "icon-192-maskable.png"), render(icon(64), 192));
writeFileSync(path.join(pub, "icon-512-maskable.png"), render(icon(64), 512));
writeFileSync(path.join(process.cwd(), "app", "icon.png"), render(icon(0), 64));
writeFileSync(
  path.join(process.cwd(), "app", "apple-icon.png"),
  render(icon(0), 180),
);
console.log("icons generated");
