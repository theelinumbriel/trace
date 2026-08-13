import { fetchWithTimeout } from "@/lib/http";
import {
  type ProviderResult,
  type RawObservation,
  type RecallProvider,
  type RecallRecord,
  reliabilityScoreFor,
} from "../types";

/**
 * openFDA food enforcement (recall) reports. UPCs appear only as free text
 * inside code_info / product_description (often space-grouped
 * "6 55974 89001 2"), so matching tries formatting variants plus brand
 * tokens. Presented as historical notices, never live status.
 * Keyless: 240 req/min, 1000/day; OPENFDA_API_KEY raises the daily cap.
 */
type OpenFdaResult = {
  recalling_firm?: string;
  product_description?: string;
  code_info?: string;
  classification?: string;
  status?: string;
  recall_initiation_date?: string; // yyyymmdd
  distribution_pattern?: string;
  recall_number?: string;
};

function upcVariants(upc12: string): string[] {
  // "655974890012" → ["655974890012", "6 55974 89001 2"]
  const spaced = `${upc12[0]} ${upc12.slice(1, 6)} ${upc12.slice(6, 11)} ${upc12[11]}`;
  return [upc12, spaced];
}

function toIso(yyyymmdd?: string): string | null {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function query(
  search: string,
  signal?: AbortSignal,
): Promise<OpenFdaResult[]> {
  const key = process.env.OPENFDA_API_KEY;
  const url =
    `https://api.fda.gov/food/enforcement.json?search=${encodeURIComponent(search)}&limit=10` +
    (key ? `&api_key=${key}` : "");
  const res = await fetchWithTimeout(url, { signal });
  if (res.status === 404) return []; // openFDA's "no results"
  if (!res.ok) throw new Error(`openFDA ${res.status}`);
  const body = (await res.json()) as { results?: OpenFdaResult[] };
  return body.results ?? [];
}

export const openFdaRecalls: RecallProvider = {
  id: "openfda-recalls",

  async recalls(q, signal): Promise<ProviderResult<RecallRecord[]>> {
    try {
      const searches: string[] = [];
      if (q.upc12) {
        for (const v of upcVariants(q.upc12)) {
          searches.push(`code_info:"${v}"`);
          searches.push(`product_description:"${v}"`);
        }
      }
      const brandToken = (q.brand ?? q.firm)?.split(/\s+/)[0];
      if (brandToken && brandToken.length >= 4) {
        searches.push(`recalling_firm:"${brandToken}"`);
      }

      const seen = new Set<string>();
      const merged: OpenFdaResult[] = [];
      for (const s of searches) {
        const results = await query(s, signal);
        for (const r of results) {
          const id = r.recall_number ?? JSON.stringify(r).slice(0, 80);
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(r);
          }
        }
      }

      const retrievedAt = new Date();
      const records: RecallRecord[] = merged.map((r) => ({
        recallingFirm: r.recalling_firm ?? "Unknown firm",
        productDescription: r.product_description ?? "",
        codeInfo: r.code_info ?? "",
        classification: r.classification ?? "",
        status: r.status ?? "",
        recallInitiationDate: toIso(r.recall_initiation_date),
        distributionPattern: r.distribution_pattern ?? "",
        url: "https://open.fda.gov/apis/food/enforcement/",
      }));
      const observations: RawObservation[] = records.map((r) => ({
        providerId: this.id,
        sourceType: "recall_database",
        sourceName: "openFDA Food Enforcement",
        sourceUrl: r.url,
        title: `FDA enforcement report — ${r.recallingFirm}`,
        publisher: "U.S. Food & Drug Administration",
        publicationDate: r.recallInitiationDate,
        retrievedAt,
        supportingText:
          `recalling_firm: "${r.recallingFirm}", classification: "${r.classification}", ` +
          `status: "${r.status}", product_description: "${r.productDescription.slice(0, 200)}"`,
        reliabilityScore: reliabilityScoreFor("recall_database"),
        license: "public data",
        structured: { ...r },
        raw: r,
      }));
      return { ok: true, data: records, observations };
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
