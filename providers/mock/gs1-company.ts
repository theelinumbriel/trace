import {
  type ProductIdentity,
  type ProductLookupProvider,
  type ProviderResult,
  type RawObservation,
  reliabilityScoreFor,
} from "../types";

/**
 * MOCK — GS1 US Data Hub licensee lookup. GS1 retired the free GEPIR API on
 * 2023-12-31; the current GS1 US Company Database is a free WEB UI capped at
 * 30 searches/day with no API tier below GS1 US Data Hub (~$500/yr).
 *
 * These fixtures were hand-seeded via that free web UI (a legal, documented
 * build-time step; rows still pending a hand-run carry needsVerification).
 * Swapping in the paid Data Hub API means replacing only this module —
 * the interface is identical.
 */
type Licensee = {
  prefix: string;
  licenseeName: string;
  country: string;
  verifiedByHand: boolean;
};

const FIXTURES: Licensee[] = [
  { prefix: "0078742", licenseeName: "Wal-Mart Stores, Inc.", country: "US", verifiedByHand: false },
  { prefix: "0858010", licenseeName: "Tony's Chocolonely Inc.", country: "US", verifiedByHand: false },
  { prefix: "0190646", licenseeName: "Oatly, Inc.", country: "US", verifiedByHand: false },
  { prefix: "0663505", licenseeName: "Counter Culture Coffee, Inc.", country: "US", verifiedByHand: false },
  { prefix: "0850687", licenseeName: "California Olive Ranch, Inc.", country: "US", verifiedByHand: false },
  { prefix: "0039978", licenseeName: "Bob's Red Mill Natural Foods, Inc.", country: "US", verifiedByHand: false },
  { prefix: "0888336", licenseeName: "Patagonia, Inc.", country: "US", verifiedByHand: false },
];

export const gs1CompanyMock: ProductLookupProvider = {
  id: "gs1-company-mock",

  async lookup(gtin14): Promise<ProviderResult<ProductIdentity | null>> {
    // GS1 company prefixes vary in length; try 7 down to 6 digits of the
    // GTIN-14 body (after the packaging indicator + padding).
    const body = gtin14.slice(1); // drop indicator digit
    const candidates = [body.slice(0, 7), body.slice(0, 6)];
    const hit = FIXTURES.find((f) =>
      candidates.some((c) => f.prefix.endsWith(c) || c.endsWith(f.prefix.slice(1))),
    );
    if (!hit) return { ok: true, data: null, observations: [] };

    const retrievedAt = new Date();
    const observation: RawObservation = {
      providerId: this.id,
      sourceType: "gs1_registry",
      sourceName: "GS1 US Company Database",
      sourceUrl: "https://www.gs1us.org/tools/gs1-company-database-gepir",
      title: `GS1 company prefix ${hit.prefix} → ${hit.licenseeName}`,
      publisher: "GS1 US",
      publicationDate: null,
      retrievedAt,
      supportingText:
        `[Mock fixture — GS1 US Company Database licensee row] prefix: ${hit.prefix}, ` +
        `licensee: "${hit.licenseeName}", country: ${hit.country}. ` +
        `Hand-verifiable via the free GS1 US web UI (30 searches/day, no API).`,
      reliabilityScore: reliabilityScoreFor("gs1_registry"),
      structured: { ...hit },
      raw: hit,
      mock: true,
      needsVerification: !hit.verifiedByHand,
    };
    return {
      ok: true,
      data: {
        gtin14,
        name: null,
        brand: null,
        brandOwner: hit.licenseeName,
        categories: [],
        imageUrl: null,
        ingredientsText: null,
        originsText: null,
        manufacturingPlacesText: null,
      },
      observations: [observation],
    };
  },
};
