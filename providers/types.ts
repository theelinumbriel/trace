import { sourceTypeEnum } from "@/db/schema";

export type SourceType = (typeof sourceTypeEnum.enumValues)[number];

/**
 * Base reliability per source type, 0–1. Single source of truth shared by
 * evidence rows (reliability_score = round(base×100)) and the confidence
 * model (lib/confidence.ts).
 */
export const SOURCE_BASE: Record<SourceType, number> = {
  traceability_system: 0.97,
  gs1_registry: 0.93,
  government_record: 0.9,
  recall_database: 0.88,
  manufacturer_disclosure: 0.86,
  sustainability_report: 0.84,
  certification: 0.84,
  customs_record: 0.78,
  product_database: 0.6,
  news_media: 0.55,
  retailer_listing: 0.5,
  other: 0.5,
};

export const reliabilityScoreFor = (t: SourceType): number =>
  Math.round(SOURCE_BASE[t] * 100);

/**
 * Immutable observation. Adapters RETURN these; only lib/engine/persist.ts
 * writes them (as evidence rows); nothing ever mutates them.
 */
export interface RawObservation {
  providerId: string;
  sourceType: SourceType;
  sourceName: string; // "Open Food Facts", "USDA FoodData Central", …
  sourceUrl: string;
  title: string; // evidence-card title
  publisher?: string;
  publicationDate: string | null; // ISO date, if the source states one
  retrievedAt: Date;
  /** Verbatim excerpt (or field quote) that supports the claim. */
  supportingText: string;
  reliabilityScore: number;
  license?: string;
  /** Deterministic parse of the payload. */
  structured: Record<string, unknown>;
  /** Full response snapshot. */
  raw: unknown;
  /** Mock adapters mark their observations so the UI can label them. */
  mock?: boolean;
  needsVerification?: boolean;
}

export type ProviderErrorCode =
  | "timeout"
  | "rate_limited"
  | "http_error"
  | "parse_error"
  | "disabled";

export type ProviderResult<T> =
  | { ok: true; data: T; observations: RawObservation[] }
  | { ok: false; error: { code: ProviderErrorCode; detail: string } };

export interface ProductIdentity {
  gtin14: string;
  name: string | null;
  brand: string | null;
  brandOwner: string | null;
  categories: string[];
  imageUrl: string | null;
  ingredientsText: string | null;
  originsText: string | null;
  manufacturingPlacesText: string | null;
}

export interface ShipmentRecord {
  shipper: string;
  consignee: string;
  originPort: { name: string; unlocode?: string; lat?: number; lng?: number };
  destinationPort: {
    name: string;
    unlocode?: string;
    lat?: number;
    lng?: number;
  };
  transportMode: "ocean" | "air" | "rail" | "truck";
  arrivalDate: string | null;
  hsCode?: string;
  weightKg?: number;
  containerCount?: number;
  /** True for mock-adapter records — surfaced in the UI as illustrative. */
  mock: boolean;
}

export interface FacilityRecord {
  name: string;
  facilityType?: string;
  city?: string;
  region?: string;
  country: string;
  lat?: number;
  lng?: number;
  osId?: string;
}

export interface RecallRecord {
  recallingFirm: string;
  productDescription: string;
  codeInfo: string;
  classification: string;
  status: string;
  recallInitiationDate: string | null;
  distributionPattern: string;
  url: string;
}

export interface EpcisEvent {
  eventType: "ObjectEvent" | "AggregationEvent" | "TransformationEvent";
  bizStep: string;
  eventTime: string;
  gtin: string;
  lot?: string;
  disposition?: string;
  location?: {
    name: string;
    country: string;
    lat?: number;
    lng?: number;
  };
}

export interface ProductLookupProvider {
  readonly id: string;
  lookup(
    gtin14: string,
    signal?: AbortSignal,
  ): Promise<ProviderResult<ProductIdentity | null>>;
}

export interface TradeDataProvider {
  readonly id: string;
  shipments(
    q: { consigneeName?: string; shipperName?: string; hsCodePrefix?: string },
    signal?: AbortSignal,
  ): Promise<ProviderResult<ShipmentRecord[]>>;
}

export interface FacilityProvider {
  readonly id: string;
  facilities(
    q: { companyName: string; country?: string },
    signal?: AbortSignal,
  ): Promise<ProviderResult<FacilityRecord[]>>;
}

export interface TraceabilityProvider {
  readonly id: string;
  itemTrace(
    q: { gtin14: string; lot?: string; serial?: string },
    signal?: AbortSignal,
  ): Promise<ProviderResult<EpcisEvent[]>>;
}

/** Fifth interface beyond the mandated four — recalls fit none of them. */
export interface RecallProvider {
  readonly id: string;
  recalls(
    q: { gtin14: string; upc12: string | null; brand?: string; firm?: string },
    signal?: AbortSignal,
  ): Promise<ProviderResult<RecallRecord[]>>;
}
