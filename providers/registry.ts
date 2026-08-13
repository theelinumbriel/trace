import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { providerFetches } from "@/db/schema";
import { openFoodFacts } from "./live/open-food-facts";
import { fdc } from "./live/fdc";
import { openFdaRecalls } from "./live/openfda-recalls";
import { upcitemdb } from "./live/upcitemdb";
import { curatedDisclosures } from "./live/curated-disclosures";
import { gs1CompanyMock } from "./mock/gs1-company";
import { billOfLadingMock } from "./mock/bill-of-lading";
import { epcisMock } from "./mock/epcis";
import type { ProviderResult, RawObservation } from "./types";

export const registry = {
  /** Ordered first-success chain for identity resolution. */
  productLookup: [openFoodFacts, fdc, upcitemdb] as const,
  /** Licensee resolution runs separately (it enriches, never identifies). */
  gs1Company: gs1CompanyMock,
  tradeData: [billOfLadingMock] as const,
  facilities: [curatedDisclosures] as const,
  traceability: [epcisMock] as const,
  recalls: [openFdaRecalls] as const,
};

/** Per-provider upstream re-fetch TTLs (hours) — rate-limit compliance. */
const FETCH_TTL_HOURS: Record<string, number> = {
  "open-food-facts": 24,
  fdc: 168,
  "openfda-recalls": 24,
  upcitemdb: 168,
};

/**
 * True if this (provider, cacheKey) was fetched inside its TTL — callers
 * should then reuse previously persisted evidence instead of calling out.
 */
export async function fetchedRecently(
  providerId: string,
  cacheKey: string,
): Promise<boolean> {
  const ttl = FETCH_TTL_HOURS[providerId];
  if (!ttl) return false;
  const db = await getDb();
  const cutoff = new Date(Date.now() - ttl * 3600_000);
  const rows = await db
    .select({ ok: providerFetches.ok })
    .from(providerFetches)
    .where(
      and(
        eq(providerFetches.providerId, providerId),
        eq(providerFetches.cacheKey, cacheKey),
        gt(providerFetches.fetchedAt, cutoff),
      ),
    )
    .limit(1);
  return rows.length > 0 && rows[0].ok;
}

export async function recordFetch(
  providerId: string,
  cacheKey: string,
  ok: boolean,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(providerFetches)
    .values({ providerId, cacheKey, fetchedAt: new Date(), ok })
    .onConflictDoUpdate({
      target: [providerFetches.providerId, providerFetches.cacheKey],
      set: { fetchedAt: new Date(), ok },
    });
}

export type ChainOutcome<T> = {
  data: T | null;
  observations: RawObservation[];
  /** Providers that failed (timeout/rate-limit) — distinct from a confirmed miss. */
  degraded: string[];
};

/**
 * First-success chain: returns the first ok+non-null result, accumulating
 * observations from every provider that responded along the way. One retry
 * on transient failure; rate-limited providers are skipped, never retried.
 */
export async function runChain<T>(
  providers: readonly { id: string }[],
  call: (provider: { id: string }) => Promise<ProviderResult<T | null>>,
): Promise<ChainOutcome<T>> {
  const observations: RawObservation[] = [];
  const degraded: string[] = [];
  for (const provider of providers) {
    let result = await call(provider);
    if (!result.ok && result.error.code === "timeout") {
      result = await call(provider); // one retry
    }
    if (!result.ok) {
      if (result.error.code !== "disabled") degraded.push(provider.id);
      continue;
    }
    observations.push(...result.observations);
    if (result.data !== null && result.data !== undefined) {
      return { data: result.data, observations, degraded };
    }
  }
  return { data: null, observations, degraded };
}

/** Fan-out merge: run all providers, merge arrays, never throw. */
export async function runAll<T>(
  providers: readonly { id: string }[],
  call: (provider: { id: string }) => Promise<ProviderResult<T[]>>,
): Promise<ChainOutcome<T[]>> {
  const observations: RawObservation[] = [];
  const degraded: string[] = [];
  const merged: T[] = [];
  const results = await Promise.all(providers.map((p) => call(p)));
  results.forEach((result, i) => {
    if (!result.ok) {
      if (result.error.code !== "disabled") degraded.push(providers[i].id);
      return;
    }
    observations.push(...result.observations);
    merged.push(...result.data);
  });
  return { data: merged, observations, degraded };
}
