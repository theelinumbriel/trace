import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { eq, ilike, or } from "drizzle-orm";
import { Barcode, ChevronRight, ScanLine } from "lucide-react";
import { getDb } from "@/db/client";
import { companies, products } from "@/db/schema";
import { normalizeGtin } from "@/lib/gtin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Search",
  description: "Find a product by UPC, GTIN, name, or brand.",
};

async function Results({ q }: { q: string }) {
  const db = await getDb();
  const asGtin = normalizeGtin(q);
  const rows = await db
    .select({
      gtin: products.gtin,
      name: products.name,
      category: products.category,
      imageUrl: products.imageUrl,
      brand: companies.name,
    })
    .from(products)
    .leftJoin(companies, eq(products.brandId, companies.id))
    .where(
      asGtin
        ? eq(products.gtin, asGtin.gtin14)
        : or(
            ilike(products.name, `%${q}%`),
            ilike(companies.name, `%${q}%`),
            ilike(products.category, `%${q}%`),
          ),
    )
    .limit(25);

  if (rows.length === 0) {
    return (
      <div className="py-12">
        <p className="text-title-2 text-ink">
          No matches for &ldquo;{q}&rdquo;.
        </p>
        <p className="mt-2 max-w-md text-meta text-ink-2">
          {asGtin
            ? "If it's a valid UPC, we'll try to resolve it and build its trace on first visit."
            : "Search covers products Trace has already seen. Scanning a barcode adds new ones."}
        </p>
        <div className="mt-5 flex gap-3">
          {asGtin && (
            <Button asChild className="rounded-full">
              <Link href={`/product/${asGtin.gtin14}`}>
                Look up {asGtin.gtin14}
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant={asGtin ? "outline" : "default"}
            className="rounded-full"
          >
            <Link href="/scan">
              <ScanLine strokeWidth={1.5} data-slot="icon" />
              Scan it instead
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline py-4">
      {rows.map((row) => (
        <li key={row.gtin}>
          <Link
            href={`/product/${row.gtin}`}
            className="flex items-center gap-4 py-4 transition-colors hover:bg-wash/50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-wash">
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.imageUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <Barcode className="h-5 w-5 text-meta" strokeWidth={1.25} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">
                {row.name}
              </span>
              <span className="block text-meta capitalize text-meta">
                {[row.brand, row.category.replace(/-/g, " ")]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="hidden text-mono-data text-meta sm:block">
              {row.gtin}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink/40" strokeWidth={1.5} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function SearchInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  return (
    <>
      <form action="/search" className="mt-6 flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          autoFocus={!q}
          placeholder="Name, brand, or barcode number"
          autoComplete="off"
        />
        <Button type="submit" className="rounded-full">
          Search
        </Button>
      </form>
      {q && (
        <Suspense
          fallback={
            <div className="space-y-4 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <Results q={q} />
        </Suspense>
      )}
    </>
  );
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 md:px-8">
      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        Search
      </p>
      <h1 className="mt-2 text-title-1 text-ink">Find a product</h1>
      <Suspense fallback={<Skeleton className="mt-6 h-10 w-full" />}>
        <SearchInner searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
