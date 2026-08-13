import { fetchWithTimeout } from "@/lib/http";
import {
  type ProductIdentity,
  type ProductLookupProvider,
  type ProviderResult,
  type RawObservation,
  reliabilityScoreFor,
} from "../types";

/**
 * UPCitemdb keyless trial tier — 100 lookups/day. Last-resort fallback for
 * non-food UPCs; the provider_fetches TTL (7 days) plus product caching
 * keeps usage far below the cap. Disable with UPCITEMDB_ENABLED=false.
 */
type UpcItem = {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  images?: string[];
};

export const upcitemdb: ProductLookupProvider = {
  id: "upcitemdb",

  async lookup(
    gtin14,
    signal,
  ): Promise<ProviderResult<ProductIdentity | null>> {
    if (process.env.UPCITEMDB_ENABLED === "false") {
      return { ok: false, error: { code: "disabled", detail: "env-disabled" } };
    }
    const upc = gtin14.replace(/^00/, "");
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`;
    try {
      const res = await fetchWithTimeout(url, { signal });
      if (res.status === 429)
        return {
          ok: false,
          error: { code: "rate_limited", detail: "UPCitemdb trial cap" },
        };
      if (res.status === 404) return { ok: true, data: null, observations: [] };
      if (!res.ok)
        return {
          ok: false,
          error: { code: "http_error", detail: `UPCitemdb ${res.status}` },
        };
      const body = (await res.json()) as { code?: string; items?: UpcItem[] };
      const item = body.items?.[0];
      if (!item) return { ok: true, data: null, observations: [] };

      const retrievedAt = new Date();
      const observation: RawObservation = {
        providerId: this.id,
        sourceType: "product_database",
        sourceName: "UPCitemdb",
        sourceUrl: `https://www.upcitemdb.com/upc/${upc}`,
        title: `UPCitemdb record — ${item.title ?? upc}`,
        publisher: "UPCitemdb",
        publicationDate: null,
        retrievedAt,
        supportingText: `title: "${item.title ?? ""}", brand: "${item.brand ?? ""}", category: "${item.category ?? ""}"`,
        reliabilityScore: reliabilityScoreFor("product_database"),
        structured: { ...item },
        raw: body,
      };
      return {
        ok: true,
        data: {
          gtin14,
          name: item.title ?? null,
          brand: item.brand ?? null,
          brandOwner: null,
          categories: item.category ? [item.category] : [],
          imageUrl: item.images?.[0] ?? null,
          ingredientsText: null,
          originsText: null,
          manufacturingPlacesText: null,
        },
        observations: [observation],
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code:
            err instanceof DOMException && err.name === "TimeoutError"
              ? "timeout"
              : "http_error",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};
