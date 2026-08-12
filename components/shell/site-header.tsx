"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const pathname = usePathname();
  // /scan is immersive: full-viewport camera, no chrome.
  if (pathname === "/scan") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-paper pt-safe">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 md:px-8">
        <Link
          href="/"
          className="text-micro font-medium uppercase tracking-widest text-ink"
        >
          Trace
        </Link>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Search products">
            <Link href="/search">
              <Search strokeWidth={1.5} />
            </Link>
          </Button>
          <Button asChild size="sm" className="rounded-full">
            <Link href="/scan">
              <ScanLine strokeWidth={1.5} data-slot="icon" />
              Scan
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
