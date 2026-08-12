import { z } from "zod";

/**
 * Zod owns every JSONB column shape — JSONB is validated on write and on
 * read (in the trace serializer); it is never trusted raw.
 */

export const RankedPathSchema = z.object({
  eventIds: z.array(z.uuid()).min(1),
  score: z.number().min(0).max(100),
  label: z.string().optional(), // "Alternate: air freight"
});
export type RankedPath = z.infer<typeof RankedPathSchema>;

export const PIPELINE_STEPS = [
  { key: "identify", label: "Product identified" },
  { key: "manufacturer", label: "Finding manufacturer" },
  { key: "origins", label: "Looking for origin data" },
  { key: "facilities", label: "Mapping facilities" },
  { key: "trade", label: "Checking trade records" },
  { key: "recalls", label: "Screening recall databases" },
  { key: "route", label: "Building route" },
] as const;

export const PipelineStepKey = z.enum([
  "identify",
  "manufacturer",
  "origins",
  "facilities",
  "trade",
  "recalls",
  "route",
]);
export type PipelineStepKeyT = z.infer<typeof PipelineStepKey>;

export const PipelineStepSchema = z.object({
  key: PipelineStepKey,
  label: z.string(),
  state: z.enum(["pending", "active", "done", "failed", "skipped"]),
  finishedAt: z.iso.datetime().optional(),
});
export const TracePipelineSchema = z.array(PipelineStepSchema);
export type TracePipeline = z.infer<typeof TracePipelineSchema>;

export function freshPipeline(): TracePipeline {
  return PIPELINE_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    state: "pending" as const,
  }));
}

/** Parsed GS1 application identifiers, keyed by AI: {"10": "L2024-118"}. */
export const GsAiDataSchema = z.record(
  z.string().regex(/^\d{2,4}$/),
  z.string(),
);
export type GsAiData = z.infer<typeof GsAiDataSchema>;
