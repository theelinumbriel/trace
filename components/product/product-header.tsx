import { notFound } from "next/navigation";
import { Barcode } from "lucide-react";
import { normalizeGtin } from "@/lib/gtin";
import { getOrCreateProduct, UpstreamUnavailableError } from "@/lib/engine/identity";
import { readProductLive } from "@/lib/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeBadge } from "./mode-badge";

/**
 * Server header: resolves identity (creating the product on first visit —
 * a pasted /product/[gtin] URL works without a prior scan).
 */
export async function ProductHeader({ gtin }: { gtin: string }) {
  const normalized = normalizeGtin(gtin);
  if (!normalized) notFound();

  let data = await readProductLive(normalized.gtin14);
  if (!data) {
    try {
      const resolved = await getOrCreateProduct(normalized.gtin14);
      if (!resolved) notFound();
      data = await readProductLive(normalized.gtin14);
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) {
        throw err; // error.tsx boundary: sources unreachable
      }
      throw err;
    }
  }
  if (!data) notFound();
  const { product } = data;

  return (
    <header className="flex items-start gap-4 pt-8">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-wash">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-contain"
          />
        ) : (
          <Barcode className="h-8 w-8 text-meta" strokeWidth={1.25} />
        )}
      </div>
      <div className="min-w-0">
        {product.brand && (
          <p className="text-micro font-medium uppercase tracking-widest text-meta">
            {product.brand}
          </p>
        )}
        <h1 className="mt-1 text-title-1 text-ink">{product.name}</h1>
        <p className="mt-1 text-meta capitalize text-meta">
          {product.category.replace(/-/g, " ")}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <ModeBadge />
          <span className="text-mono-data text-meta">{product.gtin}</span>
        </div>
      </div>
    </header>
  );
}

export function ProductHeaderSkeleton() {
  return (
    <header className="flex items-start gap-4 pt-8">
      <Skeleton className="h-24 w-24 rounded-lg" />
      <div className="flex-1 space-y-2 pt-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
    </header>
  );
}
