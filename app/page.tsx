import Link from "next/link";
import { ScanLine, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl px-5 md:px-8">
      <section className="py-16 md:py-24">
        <p className="text-micro font-medium uppercase tracking-widest text-meta">
          Scan any US barcode
        </p>
        <h1 className="mt-4 max-w-[14ch] text-display text-ink">
          Where did this come from?
        </h1>
        <p className="mt-6 max-w-md text-body text-ink-2">
          Scan almost any product to trace the people, places, materials, and
          movements behind it.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="rounded-full">
            <Link href="/scan">
              <ScanLine strokeWidth={1.5} data-slot="icon" />
              Scan a barcode
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full">
            <Link href="/search">
              <Keyboard strokeWidth={1.5} data-slot="icon" />
              Enter a barcode
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
