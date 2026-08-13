import { z } from "zod";
import {
  claimStatusEnum,
  companyTypeEnum,
  eventTypeEnum,
  facilityTypeEnum,
  sourceTypeEnum,
  transportModeEnum,
} from "./schema/enums";

/**
 * Seed file format — db/seed-data/*.json, one file per product.
 *
 * Seeds flow through the SAME evidence model and integrity gates as live
 * reconstruction: every non-unknown claim must reference at least one
 * evidence entry with a REAL source URL and a verbatim supporting excerpt.
 * The loader (scripts/seed.ts) resolves local string keys to UUIDs; keys
 * exist only in the files.
 */

const key = z.string().min(1);

export const SeedCompany = z.object({
  key,
  name: z.string().min(1),
  companyType: z.enum(companyTypeEnum.enumValues),
  country: z.string().length(2).optional(),
  website: z.url().optional(),
  parentKey: key.optional(),
});

export const SeedFacility = z.object({
  key,
  name: z.string().min(1),
  facilityType: z.enum(facilityTypeEnum.enumValues),
  companyKey: key.optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().length(2),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  osId: z.string().max(20).optional(),
  unlocode: z.string().length(5).optional(),
});

export const SeedMaterial = z.object({
  key,
  name: z.string().min(1),
  category: z.string().optional(),
  hsCode: z.string().max(10).optional(),
});

export const SeedEvidence = z.object({
  key,
  sourceName: z.string().min(1),
  sourceUrl: z.url(),
  sourceType: z.enum(sourceTypeEnum.enumValues),
  title: z.string().min(1),
  publisher: z.string().optional(),
  publicationDate: z.iso.date().optional(),
  /** Verbatim excerpt — forces a real quote, not a stub. */
  supportingText: z.string().min(20),
  reliabilityScore: z.int().min(0).max(100),
  license: z.string().optional(),
  needsVerification: z.boolean().default(false),
});

const claimIntegrity = (e: {
  status: string;
  confidence: number;
  evidence: string[];
  inferenceBasis?: string;
  key: string;
}): string[] => {
  const problems: string[] = [];
  if (e.status !== "unknown" && e.evidence.length === 0)
    problems.push(`${e.key}: non-unknown claim requires ≥1 evidence ref`);
  if (e.status === "unknown" && e.confidence !== 0)
    problems.push(`${e.key}: unknown must have confidence 0`);
  if (e.status === "inferred" && !e.inferenceBasis)
    problems.push(`${e.key}: inferred requires inferenceBasis`);
  const bands: Record<string, [number, number]> = {
    verified: [85, 100],
    documented: [70, 94],
    inferred: [1, 84],
    unknown: [0, 0],
  };
  const [lo, hi] = bands[e.status] ?? [0, 100];
  if (e.confidence < lo || e.confidence > hi)
    problems.push(
      `${e.key}: confidence ${e.confidence} outside ${e.status} band ${lo}–${hi}`,
    );
  return problems;
};

export const SeedProductMaterial = z.object({
  materialKey: key,
  role: z.enum(["primary", "packaging"]).default("primary"),
  originCountry: z.string().length(2).optional(),
  originNote: z.string().optional(),
  status: z.enum(claimStatusEnum.enumValues),
  confidence: z.int().min(0).max(100),
  evidence: z.array(key).default([]),
});

export const SeedShipment = z.object({
  key,
  originFacilityKey: key.optional(),
  destinationFacilityKey: key.optional(),
  originPortKey: key.optional(),
  destinationPortKey: key.optional(),
  transportMode: z.enum(transportModeEnum.enumValues).default("unknown"),
  departedOn: z.iso.date().optional(),
  arrivedOn: z.iso.date().optional(),
  hsCode: z.string().optional(),
  description: z.string().optional(),
  /** HARD RULE: a shipment cannot exist without evidence. */
  sourceEvidenceKey: key,
  corroboratingEvidence: z.array(key).default([]),
});

export const SeedEvent = z.object({
  key,
  eventType: z.enum(eventTypeEnum.enumValues),
  companyKey: key.optional(),
  facilityKey: key.optional(),
  shipmentKey: key.optional(),
  locationLabel: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  startedOn: z.iso.date().optional(),
  endedOn: z.iso.date().optional(),
  status: z.enum(claimStatusEnum.enumValues),
  confidence: z.int().min(0).max(100),
  /** "Why we think this" — required for every status incl. unknown. */
  evidenceSummary: z.string().min(20),
  inferenceBasis: z.string().optional(),
  lotCode: z.string().optional(),
  evidence: z.array(key).default([]),
});

export const SeedFileSchema = z
  .object({
    product: z.object({
      gtin: z.string().regex(/^\d{14}$/),
      upc: z
        .string()
        .regex(/^\d{12}$/)
        .optional(),
      upcVerification: z.enum(["verified", "needs-verification"]),
      name: z.string().min(1),
      category: z.string().min(1),
      brandKey: key,
      manufacturerKey: key.optional(),
      imageUrl: z.url().optional(),
      description: z.string().optional(),
      ingredientsText: z.string().optional(),
      identityEvidenceKey: key,
    }),
    companies: z.array(SeedCompany).min(1),
    facilities: z.array(SeedFacility).default([]),
    materials: z.array(SeedMaterial).default([]),
    productMaterials: z.array(SeedProductMaterial).default([]),
    shipments: z.array(SeedShipment).default([]),
    evidence: z.array(SeedEvidence).min(1),
    events: z.array(SeedEvent).min(1),
    /** Ordered event keys of the primary journey. */
    bestPath: z.array(key).min(1),
    altPaths: z
      .array(
        z.object({
          eventKeys: z.array(key).min(1),
          score: z.number().min(0).max(100),
          label: z.string().optional(),
        }),
      )
      .default([]),
  })
  .superRefine((file, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });

    const evidenceKeys = new Set(file.evidence.map((e) => e.key));
    const eventKeys = new Set(file.events.map((e) => e.key));
    const companyKeys = new Set(file.companies.map((c) => c.key));
    const facilityKeys = new Set(file.facilities.map((f) => f.key));
    const materialKeys = new Set(file.materials.map((m) => m.key));
    const shipmentKeys = new Set(file.shipments.map((s) => s.key));

    for (const [name, list, set] of [
      ["evidence", file.evidence, evidenceKeys],
      ["events", file.events, eventKeys],
      ["companies", file.companies, companyKeys],
      ["facilities", file.facilities, facilityKeys],
    ] as const) {
      if (set.size !== list.length) issue(`duplicate keys in ${name}`);
    }

    if (!evidenceKeys.has(file.product.identityEvidenceKey))
      issue(`identityEvidenceKey ${file.product.identityEvidenceKey} missing`);
    if (!companyKeys.has(file.product.brandKey))
      issue(`brandKey ${file.product.brandKey} missing`);
    if (
      file.product.manufacturerKey &&
      !companyKeys.has(file.product.manufacturerKey)
    )
      issue(`manufacturerKey ${file.product.manufacturerKey} missing`);

    for (const e of file.events) {
      for (const p of claimIntegrity(e)) issue(p);
      for (const ref of e.evidence)
        if (!evidenceKeys.has(ref)) issue(`${e.key}: unknown evidence ${ref}`);
      if (e.companyKey && !companyKeys.has(e.companyKey))
        issue(`${e.key}: unknown company ${e.companyKey}`);
      if (e.facilityKey && !facilityKeys.has(e.facilityKey))
        issue(`${e.key}: unknown facility ${e.facilityKey}`);
      if (e.shipmentKey && !shipmentKeys.has(e.shipmentKey))
        issue(`${e.key}: unknown shipment ${e.shipmentKey}`);
    }

    for (const pm of file.productMaterials) {
      for (const p of claimIntegrity({ ...pm, key: pm.materialKey })) issue(p);
      if (!materialKeys.has(pm.materialKey))
        issue(`productMaterials: unknown material ${pm.materialKey}`);
      for (const ref of pm.evidence)
        if (!evidenceKeys.has(ref))
          issue(`${pm.materialKey}: unknown evidence ${ref}`);
    }

    for (const s of file.shipments) {
      if (!evidenceKeys.has(s.sourceEvidenceKey))
        issue(`${s.key}: unknown sourceEvidence ${s.sourceEvidenceKey}`);
      for (const fk of [
        s.originFacilityKey,
        s.destinationFacilityKey,
        s.originPortKey,
        s.destinationPortKey,
      ])
        if (fk && !facilityKeys.has(fk))
          issue(`${s.key}: unknown facility ${fk}`);
    }

    for (const k of file.bestPath)
      if (!eventKeys.has(k)) issue(`bestPath: unknown event ${k}`);
    for (const alt of file.altPaths)
      for (const k of alt.eventKeys)
        if (!eventKeys.has(k)) issue(`altPaths: unknown event ${k}`);
  });

export type SeedFile = z.infer<typeof SeedFileSchema>;
