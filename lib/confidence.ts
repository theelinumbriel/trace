import { SOURCE_BASE, type SourceType } from "@/providers/types";

/**
 * Deterministic, explainable confidence scoring. Pure and synchronous: no
 * clock reads (caller passes asOf), no randomness — a persisted trace
 * re-scores byte-identically forever. Every returned number ships with a
 * breakdown that the evidence drawer renders verbatim.
 *
 * Bands (DB-enforced by events_band_ck):
 *   verified   85–100  direct structured traceability, or ≥2 independent
 *                      primary sources
 *   documented 70–94   explicit documentation from the responsible party
 *   inferred    1–84   derived from sourced evidence via a stated basis
 *                      (<50 is excluded from the primary path)
 *   unknown     0      no evidence — a first-class gap, never a guess
 */

export type Specificity =
  | "exact_item"
  | "exact_product"
  | "brand_level"
  | "company_level";

export type EvidenceInput = {
  id?: string;
  sourceType: SourceType;
  publicationDate: string | null; // ISO date or null
  /** Publisher domain for independence grouping ("oatly.com"). */
  sourceDomain: string;
  specificity: Specificity;
};

export type ClaimStatus = "verified" | "documented" | "inferred" | "unknown";

export type ScoreBreakdown = {
  perEvidence: {
    id?: string;
    sourceType: SourceType;
    domain: string;
    base: number;
    recency: number;
    specificity: number;
    weight: number;
  }[];
  combined: number;
  cap: number;
  depthPenalty: number;
  raw: number;
  independentPrimaryDomains: number;
  directClass: boolean;
  documentaryClass: boolean;
};

const SPEC_WEIGHT: Record<Specificity, number> = {
  exact_item: 1.0,
  exact_product: 0.95,
  brand_level: 0.85,
  company_level: 0.7,
};

/** Recency half-life in years, per source type. */
const HALF_LIFE: Record<SourceType, number> = {
  traceability_system: 3,
  gs1_registry: 5,
  government_record: 5,
  recall_database: 5,
  manufacturer_disclosure: 2,
  sustainability_report: 2,
  certification: 3,
  customs_record: 3,
  product_database: 2,
  news_media: 2,
  retailer_listing: 2,
  other: 2,
};

const DOCUMENTARY: ReadonlySet<SourceType> = new Set([
  "manufacturer_disclosure",
  "sustainability_report",
  "certification",
  "gs1_registry",
  "recall_database",
  "government_record",
]);

function isDirect(e: EvidenceInput): boolean {
  return (
    (e.sourceType === "traceability_system" &&
      (e.specificity === "exact_item" || e.specificity === "exact_product")) ||
    (e.sourceType === "government_record" && e.specificity === "exact_product")
  );
}

function recencyFactor(e: EvidenceInput, asOf: Date): number {
  if (!e.publicationDate) return 0.8;
  const published = new Date(`${e.publicationDate}T00:00:00Z`).getTime();
  const ageYears = Math.max(0, (asOf.getTime() - published) / 31_557_600_000);
  // 12-month grace period (current docs are current), then half-life decay
  // with a floor — old evidence degrades but never evaporates.
  const decayYears = Math.max(0, ageYears - 1);
  const halfLife = HALF_LIFE[e.sourceType];
  return Math.max(0.6, 0.5 ** (decayYears / halfLife));
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function scoreClaim(
  evidence: EvidenceInput[],
  inferredDepth: number,
  asOf: Date,
): { confidence: number; status: ClaimStatus; breakdown: ScoreBreakdown } {
  if (evidence.length === 0) {
    return {
      confidence: 0,
      status: "unknown",
      breakdown: {
        perEvidence: [],
        combined: 0,
        cap: 0,
        depthPenalty: 1,
        raw: 0,
        independentPrimaryDomains: 0,
        directClass: false,
        documentaryClass: false,
      },
    };
  }

  const perEvidence = evidence.map((e) => {
    const base = SOURCE_BASE[e.sourceType];
    const recency = recencyFactor(e, asOf);
    const specificity = SPEC_WEIGHT[e.specificity];
    return {
      id: e.id,
      sourceType: e.sourceType,
      domain: e.sourceDomain,
      base,
      recency,
      specificity,
      weight: base * recency * specificity,
    };
  });

  // Same publisher never stacks: max weight per domain, noisy-OR across
  // independent domains.
  const byDomain = new Map<string, number>();
  for (const e of perEvidence) {
    byDomain.set(e.domain, Math.max(byDomain.get(e.domain) ?? 0, e.weight));
  }
  let combined = 1;
  for (const w of byDomain.values()) combined *= 1 - w;
  combined = 1 - combined;

  const directClass = evidence.some(isDirect);
  const documentaryClass = evidence.some((e) => DOCUMENTARY.has(e.sourceType));
  const independentPrimaryDomains = new Set(
    evidence
      .filter((e) => DOCUMENTARY.has(e.sourceType) || isDirect(e))
      .map((e) => e.sourceDomain),
  ).size;

  const cap = directClass ? 1.0 : documentaryClass ? 0.94 : 0.84;
  const depthPenalty = 0.85 ** inferredDepth;
  const raw = Math.min(combined, cap) * depthPenalty;
  let confidence = Math.round(100 * raw);

  let status: ClaimStatus;
  if (inferredDepth > 0) {
    status = "inferred";
    confidence = clamp(confidence, 1, 84);
  } else if (directClass && confidence >= 85) {
    status = "verified";
    confidence = clamp(confidence, 85, 100);
  } else if (independentPrimaryDomains >= 2 && confidence >= 85) {
    status = "verified";
    confidence = clamp(confidence, 85, 94);
  } else if (documentaryClass && confidence >= 70) {
    status = "documented";
    confidence = clamp(confidence, 70, 94);
  } else {
    // Weak or indirect support is inference-grade: the claim rests on
    // evidence, but not the responsible party's own documentation.
    status = "inferred";
    confidence = clamp(confidence, 1, 84);
  }

  return {
    confidence,
    status,
    breakdown: {
      perEvidence,
      combined,
      cap,
      depthPenalty,
      raw,
      independentPrimaryDomains,
      directClass,
      documentaryClass,
    },
  };
}

/** Band label for the confidence meter ("Strong combination of records"). */
export function bandLabel(confidence: number): string {
  if (confidence >= 95) return "Direct structured traceability";
  if (confidence >= 85) return "Explicit documentation or corroborated records";
  if (confidence >= 70) return "Strong combination of independent records";
  if (confidence >= 50) return "Reasonable inference from sourced evidence";
  if (confidence >= 1) return "Weak evidence — treat as uncertain";
  return "No evidence";
}
