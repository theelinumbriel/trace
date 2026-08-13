import { fetchWithTimeout } from "@/lib/http";
import {
  type ProductIdentity,
  type ProductLookupProvider,
  type ProviderResult,
  type RawObservation,
  reliabilityScoreFor,
} from "../types";

const FIELDS =
  "code,product_name,brands,brand_owner,categories,origins,manufacturing_places,image_front_url,ingredients_text";

/**
 * Open Food Facts + sibling databases (Products/Beauty/Pet Food Facts —
 * same Product Opener API). ODbL: attribution rendered in the site footer
 * and on every OFF-derived evidence card; derived data stays in evidence
 * rows (separable layer).
 *
 * Rate limits: 15 read req/min/IP — respected via provider_fetches TTLs in
 * the registry, not here.
 */
const HOSTS: { host: string; name: string; v3: boolean }[] = [
  { host: "world.openfoodfacts.org", name: "Open Food Facts", v3: true },
  { host: "world.openproductsfacts.org", name: "Open Products Facts", v3: false },
  { host: "world.openbeautyfacts.org", name: "Open Beauty Facts", v3: false },
  { host: "world.openpetfoodfacts.org", name: "Open Pet Food Facts", v3: false },
];

function userAgent(): string {
  return process.env.OFF_USER_AGENT ?? "Trace/0.1 (dev build; no contact set)";
}

type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  brand_owner?: string;
  categories?: string;
  origins?: string;
  manufacturing_places?: string;
  image_front_url?: string;
  ingredients_text?: string;
};

function quote(p: OffProduct): string {
  const parts: string[] = [];
  if (p.product_name) parts.push(`product_name: "${p.product_name}"`);
  if (p.brands) parts.push(`brands: "${p.brands}"`);
  if (p.brand_owner) parts.push(`brand_owner: "${p.brand_owner}"`);
  if (p.origins) parts.push(`origins: "${p.origins}"`);
  if (p.manufacturing_places)
    parts.push(`manufacturing_places: "${p.manufacturing_places}"`);
  return parts.join(", ");
}

export const openFoodFacts: ProductLookupProvider = {
  id: "open-food-facts",

  async lookup(
    gtin14,
    signal,
  ): Promise<ProviderResult<ProductIdentity | null>> {
    // OFF canonical barcodes drop GTIN-14 padding down to EAN-13/UPC length.
    const code = gtin14.replace(/^0{0,6}(?=\d{8,13}$)/, "");
    let lastError: { code: "timeout" | "http_error" | "rate_limited" | "parse_error"; detail: string } | null =
      null;

    for (const { host, name, v3 } of HOSTS) {
      const url = v3
        ? `https://${host}/api/v3/product/${code}?fields=${FIELDS}`
        : `https://${host}/api/v2/product/${code}?fields=${FIELDS}`;
      try {
        const res = await fetchWithTimeout(url, {
          headers: { "User-Agent": userAgent() },
          signal,
        });
        if (res.status === 429 || res.status === 503) {
          lastError = { code: "rate_limited", detail: `${host} ${res.status}` };
          continue;
        }
        if (res.status === 404) continue; // not in this database
        if (!res.ok) {
          lastError = { code: "http_error", detail: `${host} ${res.status}` };
          continue;
        }
        const body = (await res.json()) as {
          status?: string | number;
          result?: { id?: string };
          product?: OffProduct;
        };
        const found = v3
          ? body.status === "success" ||
            body.result?.id === "product_found"
          : body.status === 1;
        if (!found || !body.product) continue;

        const p = body.product;
        const retrievedAt = new Date();
        const productPage = `https://${host}/product/${code}`;
        const observation: RawObservation = {
          providerId: this.id,
          sourceType: "product_database",
          sourceName: name,
          sourceUrl: productPage,
          title: `${name} record for ${p.product_name ?? code}`,
          publisher: "Open Food Facts contributors",
          publicationDate: null,
          retrievedAt,
          supportingText: quote(p) || `Product record exists for code ${code}.`,
          reliabilityScore: reliabilityScoreFor("product_database"),
          license: "ODbL",
          structured: { ...p },
          raw: body,
        };
        return {
          ok: true,
          data: {
            gtin14,
            name: p.product_name ?? null,
            brand: p.brands?.split(",")[0]?.trim() ?? null,
            brandOwner: p.brand_owner ?? null,
            categories:
              p.categories
                ?.split(",")
                .map((c) => c.trim())
                .filter(Boolean) ?? [],
            imageUrl: p.image_front_url ?? null,
            ingredientsText: p.ingredients_text ?? null,
            originsText: p.origins || null,
            manufacturingPlacesText: p.manufacturing_places || null,
          },
          observations: [observation],
        };
      } catch (err) {
        lastError = {
          code: err instanceof DOMException && err.name === "TimeoutError"
            ? "timeout"
            : "http_error",
          detail: `${host}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (lastError && lastError.code !== "http_error") {
      return { ok: false, error: lastError };
    }
    // Confirmed miss across all hosts (or plain HTTP misses): a real null.
    return { ok: true, data: null, observations: [] };
  },
};
