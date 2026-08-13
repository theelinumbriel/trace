import { and, eq } from "drizzle-orm";
import {
  unstable_cacheLife as cacheLife,
  unstable_cacheTag as cacheTag,
} from "next/cache";
import { getDb } from "@/db/client";
import { companies, products, traces } from "@/db/schema";
import type { ProductSummary } from "@/lib/schemas/api";

export type ProductWithTrace = {
  product: ProductSummary;
  brandName: string | null;
  trace: {
    id: string;
    state: "pending" | "running" | "complete" | "partial" | "failed";
    computedAt: string | null;
  } | null;
};

async function readProduct(gtin14: string): Promise<ProductWithTrace | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      product: products,
      brandName: companies.name,
    })
    .from(products)
    .leftJoin(companies, eq(products.brandId, companies.id))
    .where(eq(products.gtin, gtin14))
    .limit(1);
  if (!row) return null;

  const [trace] = await db
    .select({
      id: traces.id,
      status: traces.status,
      computedAt: traces.computedAt,
    })
    .from(traces)
    .where(
      and(eq(traces.productId, row.product.id), eq(traces.kind, "product")),
    )
    .limit(1);

  return {
    product: {
      gtin: row.product.gtin,
      upc: row.product.upc,
      name: row.product.name,
      brand: row.brandName,
      category: row.product.category,
      imageUrl: row.product.imageUrl,
      description: row.product.description,
      ingredientsText: row.product.ingredientsText,
    },
    brandName: row.brandName,
    trace: trace
      ? {
          id: trace.id,
          state: trace.status,
          computedAt: trace.computedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Cached product identity — the "renders instantly after a scan" read.
 * Tagged per GTIN; the engine revalidates `trace:{gtin}` on finalize and
 * product identity changes are rare (days-scale lifetime is fine).
 */
export async function getProductIdentity(
  gtin14: string,
): Promise<ProductWithTrace | null> {
  "use cache";
  cacheTag(`product:${gtin14}`, `trace:${gtin14}`);
  cacheLife("hours");
  return readProduct(gtin14);
}

/** Uncached variant for API routes that must reflect live trace state. */
export const readProductLive = readProduct;
