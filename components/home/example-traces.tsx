import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Barcode } from "lucide-react";
import { getDb } from "@/db/client";
import { companies, products, traces } from "@/db/schema";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Seeded example traces on the homepage — including the sparse ones, so
 * expectations are honest from the first screen.
 */
export async function ExampleTraces() {
  let rows: {
    gtin: string;
    name: string;
    category: string;
    imageUrl: string | null;
    brand: string | null;
    pathScore: number | null;
  }[] = [];
  try {
    const db = await getDb();
    rows = await db
      .select({
        gtin: products.gtin,
        name: products.name,
        category: products.category,
        imageUrl: products.imageUrl,
        brand: companies.name,
        pathScore: traces.pathScore,
      })
      .from(products)
      .innerJoin(
        traces,
        and(eq(traces.productId, products.id), eq(traces.kind, "product")),
      )
      .leftJoin(companies, eq(products.brandId, companies.id))
      .where(eq(traces.engineVersion, "seed-1"))
      .limit(8);
  } catch {
    return null; // DB not reachable — the homepage stays serene
  }
  if (rows.length === 0) return null;

  return (
    <section className="pb-16">
      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        Example traces
      </p>
      <div className="no-scrollbar -mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 md:-mx-8 md:px-8">
        {rows.map((row) => (
          <Link
            key={row.gtin}
            href={`/product/${row.gtin}`}
            className="w-44 shrink-0 snap-start rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-ink"
          >
            <span className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-wash">
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.imageUrl}
                  alt=""
                  className="h-full w-full object-contain p-1"
                />
              ) : (
                <Barcode className="h-6 w-6 text-meta" strokeWidth={1.25} />
              )}
            </span>
            {row.brand && (
              <span className="mt-3 block truncate text-micro font-medium uppercase tracking-widest text-meta">
                {row.brand}
              </span>
            )}
            <span className="mt-0.5 line-clamp-2 text-meta font-medium text-ink">
              {row.name}
            </span>
            <span className="mt-1 block text-micro capitalize text-meta">
              {row.category.replace(/-/g, " ")}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ExampleTracesSkeleton() {
  return (
    <section className="pb-16">
      <Skeleton className="h-3 w-28" />
      <div className="-mx-5 mt-4 flex gap-3 overflow-hidden px-5 md:-mx-8 md:px-8">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-44 shrink-0 rounded-xl" />
        ))}
      </div>
    </section>
  );
}
