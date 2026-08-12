import { cn } from "@/lib/utils";

/**
 * The five display statuses. The DB claim_status enum has four
 * (verified/documented/inferred/unknown); "observed" is UI-only — it labels
 * the user's own scan node, which is a first-party observation, not a claim.
 */
export type TraceStatus =
  | "verified"
  | "documented"
  | "inferred"
  | "unknown"
  | "observed";

export const STATUS_LABEL: Record<TraceStatus, string> = {
  verified: "Verified",
  documented: "Documented",
  inferred: "Inferred",
  unknown: "Unknown",
  observed: "Observed",
};

const STATUS_TEXT_CLASS: Record<TraceStatus, string> = {
  verified: "text-verified",
  documented: "text-ink",
  inferred: "text-inferred",
  unknown: "text-meta",
  observed: "text-ink",
};

/**
 * Hand-rolled status glyphs — the app's visual grammar for evidence.
 * Status is never encoded by color alone: shape + (optional) label always.
 *   verified   ✓ in a solid green circle
 *   documented ✓ in an outlined ink circle
 *   inferred   ◐ half-filled amber circle
 *   unknown    ? in a dashed gray circle
 *   observed   ● solid ink dot
 */
export function StatusGlyph({
  status,
  size = 16,
  withLabel = false,
  className,
}: {
  status: TraceStatus;
  size?: 16 | 20 | 24;
  withLabel?: boolean;
  className?: string;
}) {
  const glyph = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden={withLabel ? undefined : true}
      role={withLabel ? undefined : "img"}
      className={cn("shrink-0", !withLabel && className)}
    >
      {!withLabel && <title>{STATUS_LABEL[status]}</title>}
      {status === "verified" && (
        <>
          <circle cx="8" cy="8" r="7.25" className="fill-verified" />
          <path
            d="M4.8 8.2l2.2 2.2 4.2-4.6"
            stroke="#FAF9F6"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === "documented" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.75"
            className="stroke-ink"
            strokeWidth="1.25"
          />
          <path
            d="M4.9 8.2l2.1 2.1 4-4.4"
            className="stroke-ink"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === "inferred" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.75"
            className="stroke-inferred"
            strokeWidth="1.25"
          />
          <path d="M8 1.25a6.75 6.75 0 010 13.5z" className="fill-inferred" />
        </>
      )}
      {status === "unknown" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.75"
            className="stroke-unknown"
            strokeWidth="1.25"
            strokeDasharray="2.4 2.2"
          />
          <text
            x="8"
            y="11.4"
            textAnchor="middle"
            fontSize="9"
            fontWeight="600"
            className="fill-unknown"
          >
            ?
          </text>
        </>
      )}
      {status === "observed" && (
        <circle cx="8" cy="8" r="4.5" className="fill-ink" />
      )}
    </svg>
  );

  if (!withLabel) return glyph;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-micro font-medium uppercase",
        STATUS_TEXT_CLASS[status],
        className,
      )}
    >
      {glyph}
      {STATUS_LABEL[status]}
    </span>
  );
}
