"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ATTRIBUTIONS = [
  {
    name: "Open Food Facts",
    href: "https://openfoodfacts.org",
    license: "ODbL",
  },
  {
    name: "USDA FoodData Central",
    href: "https://fdc.nal.usda.gov",
    license: "CC0",
  },
  { name: "openFDA", href: "https://open.fda.gov", license: "public data" },
  {
    name: "Open Supply Hub",
    href: "https://opensupplyhub.org",
    license: "CC BY-SA 4.0",
  },
];

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/scan") return null;

  return (
    <footer className="border-t border-hairline bg-paper pb-safe-4">
      <div className="mx-auto max-w-2xl space-y-4 px-5 py-10 md:px-8">
        <p className="text-micro font-medium uppercase tracking-widest text-ink">
          Trace
        </p>
        <p className="text-meta text-ink-2">
          Every step is sourced or labeled as an inference. Unknowns are shown,
          not filled in.
        </p>
        <p className="text-meta text-meta">
          Product and provenance data from{" "}
          {ATTRIBUTIONS.map((a, i) => (
            <span key={a.name}>
              <Link
                href={a.href}
                className="underline underline-offset-2 hover:text-ink"
                target="_blank"
                rel="noreferrer"
              >
                {a.name}
              </Link>{" "}
              ({a.license}){i < ATTRIBUTIONS.length - 1 ? " · " : "."}
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}
