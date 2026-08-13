import { fetchWithTimeout } from "@/lib/http";
import {
  type ProductIdentity,
  type ProductLookupProvider,
  type ProviderResult,
  type RawObservation,
  reliabilityScoreFor,
} from "../types";

/**
 * USDA FoodData Central (Branded Foods). CC0 / public domain. Free API key
 * from api.data.gov; DEMO_KEY works for development (30 req/hr).
 * There is no barcode endpoint — the GTIN goes into the general search
 * query and the match is confirmed against the returned gtinUpc field.
 */
type FdcFood = {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  ingredients?: string;
  brandedFoodCategory?: string;
};

export const fdc: ProductLookupProvider = {
  id: "fdc",

  async lookup(
    gtin14,
    signal,
  ): Promise<ProviderResult<ProductIdentity | null>> {
    const apiKey = process.env.FDC_API_KEY || "DEMO_KEY";
    // FDC stores UPC-A as 12 digits (no GTIN-14 padding); some records use
    // 13. Try the most likely form.
    const upc12 = gtin14.startsWith("00") ? gtin14.slice(2) : null;
    const query = upc12 ?? gtin14.replace(/^0+/, "");
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${query}&dataType=Branded&pageSize=5`;

    try {
      const res = await fetchWithTimeout(url, { signal });
      if (res.status === 429)
        return {
          ok: false,
          error: { code: "rate_limited", detail: "FDC 429" },
        };
      if (!res.ok)
        return {
          ok: false,
          error: { code: "http_error", detail: `FDC ${res.status}` },
        };
      const body = (await res.json()) as { foods?: FdcFood[] };
      const candidates = body.foods ?? [];
      const match = candidates.find((f) => {
        const g = f.gtinUpc?.replace(/\D/g, "");
        if (!g) return false;
        return g.padStart(14, "0") === gtin14;
      });
      if (!match) return { ok: true, data: null, observations: [] };

      const retrievedAt = new Date();
      const sourceUrl = match.fdcId
        ? `https://fdc.nal.usda.gov/food-details/${match.fdcId}/nutrients`
        : "https://fdc.nal.usda.gov/";
      const observation: RawObservation = {
        providerId: this.id,
        sourceType: "government_record",
        sourceName: "USDA FoodData Central",
        sourceUrl,
        title: `FDC Branded Food record ${match.fdcId ?? ""} — ${match.description ?? query}`,
        publisher: "U.S. Department of Agriculture",
        publicationDate: null,
        retrievedAt,
        supportingText:
          `gtinUpc: "${match.gtinUpc}", description: "${match.description ?? ""}"` +
          (match.brandOwner ? `, brandOwner: "${match.brandOwner}"` : ""),
        reliabilityScore: reliabilityScoreFor("government_record"),
        license: "CC0-1.0",
        structured: { ...match },
        raw: body,
      };
      return {
        ok: true,
        data: {
          gtin14,
          name: match.description ?? null,
          brand: match.brandName ?? null,
          brandOwner: match.brandOwner ?? null,
          categories: match.brandedFoodCategory
            ? [match.brandedFoodCategory]
            : [],
          imageUrl: null,
          ingredientsText: match.ingredients ?? null,
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
