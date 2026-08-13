import Link from "next/link";
import { Barcode, ScanLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-5 py-20 md:px-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-hairline bg-wash">
        <Barcode className="h-7 w-7 text-meta" strokeWidth={1.25} />
      </div>
      <h1 className="mt-6 text-title-1 text-ink">
        We couldn&apos;t identify this barcode.
      </h1>
      <p className="mt-3 max-w-md text-body text-ink-2">
        The code is structurally valid, but no product data exists for it in
        any source we query. Coverage is strongest for US food products;
        non-food coverage is limited.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild className="rounded-full">
          <Link href="/scan">
            <ScanLine strokeWidth={1.5} data-slot="icon" />
            Scan again
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/search">
            <Search strokeWidth={1.5} data-slot="icon" />
            Search by name
          </Link>
        </Button>
      </div>
    </div>
  );
}
