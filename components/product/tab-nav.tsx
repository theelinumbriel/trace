"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "journey", label: "Journey", path: "" },
  { key: "map", label: "Map", path: "/map" },
  { key: "sources", label: "Sources", path: "/sources" },
] as const;

function TabNavInner({ gtin }: { gtin: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const base = `/product/${gtin}`;

  return (
    <nav
      aria-label="Product views"
      className="sticky top-14 z-30 -mx-5 mt-6 border-b border-hairline bg-paper px-5 md:-mx-8 md:px-8"
    >
      <div className="flex gap-6">
        {TABS.map((tab) => {
          const href = `${base}${tab.path}${qs ? `?${qs}` : ""}`;
          const active =
            tab.path === ""
              ? pathname === base
              : pathname === `${base}${tab.path}`;
          return (
            <Link
              key={tab.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 py-3 text-meta font-medium transition-colors",
                active
                  ? "border-ink text-ink"
                  : "border-transparent text-meta hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function TabNav({ gtin }: { gtin: string }) {
  return (
    <Suspense fallback={<div className="mt-6 h-12 border-b border-hairline" />}>
      <TabNavInner gtin={gtin} />
    </Suspense>
  );
}
