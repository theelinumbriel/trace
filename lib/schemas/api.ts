import { z } from "zod";

/** Zod contracts for every API route. The serializer emits these shapes. */

export const zGtinInput = z.string().regex(/^[0-9]{8,14}$/);
export const zGtin14 = z.string().regex(/^[0-9]{14}$/);

/** Display statuses — DB claim_status plus UI-only "observed" (the scan). */
export const zTraceStatus = z.enum([
  "verified",
  "documented",
  "inferred",
  "unknown",
  "observed",
]);
export const zConfidence = z.number().int().min(0).max(100);
export const zTraceState = z.enum([
  "pending",
  "running",
  "complete",
  "partial",
  "failed",
]);

export const zEvidenceCard = z.object({
  id: z.uuid(),
  sourceName: z.string(),
  sourceType: z.string(),
  title: z.string(),
  publisher: z.string().nullable(),
  sourceUrl: z.string(),
  publicationDate: z.string().nullable(),
  retrievedAt: z.string(),
  supportingText: z.string(),
  license: z.string().nullable(),
  relevance: z.string(),
  mock: z.boolean(),
  needsVerification: z.boolean(),
});
export type EvidenceCard = z.infer<typeof zEvidenceCard>;

export const zScoreBreakdown = z
  .object({
    combined: z.number(),
    cap: z.number(),
    depthPenalty: z.number(),
    independentPrimaryDomains: z.number(),
  })
  .partial()
  .nullable();

export const zEvent = z.object({
  id: z.uuid(),
  seq: z.number().int(), // renders "01"
  eventType: z.string(),
  title: z.string(), // "Origin", "Ocean freight", …
  locationLabel: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  dateRange: z.string().nullable(), // "Mar–Apr 2026"
  status: zTraceStatus,
  confidence: zConfidence,
  evidenceSummary: z.string(),
  inferenceBasis: z.string().nullable(),
  lotCode: z.string().nullable(),
  /** True when any supporting evidence is from a mock adapter. */
  illustrative: z.boolean(),
  evidence: z.array(zEvidenceCard),
});
export type TraceEvent = z.infer<typeof zEvent>;

export const zPipelineStep = z.object({
  key: z.string(),
  label: z.string(),
  state: z.enum(["pending", "active", "done", "failed", "skipped"]),
});

export const zStatusCounts = z.object({
  verified: z.number().int(),
  documented: z.number().int(),
  inferred: z.number().int(),
  unknown: z.number().int(),
});
export type StatusCounts = z.infer<typeof zStatusCounts>;

export const zTraceView = z.object({
  traceId: z.uuid(),
  gtin: zGtin14,
  kind: z.enum(["product", "batch"]),
  lotCode: z.string().nullable(),
  serial: z.string().nullable(),
  /** AI(17) from the scanned code — observed, not a claim. */
  expiryDate: z.string().nullable(),
  state: zTraceState,
  pipeline: z.array(zPipelineStep),
  events: z.array(zEvent), // primary journey, ordered
  recalls: z.array(zEvent), // off-path recall notices
  counts: zStatusCounts,
  pathScore: z.number().nullable(),
  engineVersion: z.string(),
  sourcesAsOf: z.string(),
  computedAt: z.string().nullable(),
});
export type TraceView = z.infer<typeof zTraceView>;

export const zProductSummary = z.object({
  gtin: zGtin14,
  upc: z.string().nullable(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  description: z.string().nullable(),
  ingredientsText: z.string().nullable(),
});
export type ProductSummary = z.infer<typeof zProductSummary>;

// ---------------------------------------------------------------- requests

export const zLookupRequest = z.object({
  /** Raw scan/paste value: digits, GS1 element string, or Digital Link URI. */
  code: z.string().min(8).max(400),
  symbology: z
    .enum(["upc_a", "ean_13", "ean_8", "data_matrix", "qr_code", "manual"])
    .default("manual"),
  locality: z.string().max(80).optional(),
  /** Defense in depth: server re-rounds to 2 decimals (~1.1 km). */
  approxLat: z
    .number()
    .min(-90)
    .max(90)
    .transform((v) => Math.round(v * 100) / 100)
    .optional(),
  approxLng: z
    .number()
    .min(-180)
    .max(180)
    .transform((v) => Math.round(v * 100) / 100)
    .optional(),
});

export const zReconstructRequest = z.object({
  gtin: zGtinInput,
  mode: z.enum(["product", "batch"]).default("product"),
  lot: z.string().max(40).optional(),
  serial: z.string().max(40).optional(),
  expiryDate: z.iso.date().optional(),
  /** Honored only outside production. */
  force: z.boolean().default(false),
});

// --------------------------------------------------------------- responses

export const zLookupResponse = z.object({
  product: zProductSummary,
  gtin14: zGtin14,
  mode: z.enum(["product", "batch"]),
  batch: z
    .object({
      lot: z.string().nullable(),
      serial: z.string().nullable(),
      expiryDate: z.string().nullable(),
    })
    .nullable(),
  traceState: zTraceState.nullable(),
});

export const zProductResponse = z.object({
  product: zProductSummary,
  trace: z
    .object({
      id: z.uuid(),
      state: zTraceState,
      computedAt: z.string().nullable(),
    })
    .nullable(),
});

export const zSourceCard = zEvidenceCard.extend({
  claimsSupported: z.array(
    z.object({ eventId: z.uuid().nullable(), title: z.string() }),
  ),
});
export type SourceCard = z.infer<typeof zSourceCard>;

export const zSourcesResponse = z.object({
  sources: z.array(zSourceCard),
});
