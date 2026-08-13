import { bandLabel } from "@/lib/confidence";
import { cn } from "@/lib/utils";

/** 2px confidence bar with band ticks at 50 / 70 / 85 / 95. */
export function ConfidenceMeter({
  confidence,
  status,
}: {
  confidence: number;
  status: string;
}) {
  const color =
    status === "verified"
      ? "bg-verified"
      : status === "inferred"
        ? "bg-inferred"
        : status === "unknown"
          ? "bg-unknown"
          : "bg-ink";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-mono-data font-medium text-ink">
          {confidence} / 100
        </span>
        <span className="text-micro uppercase tracking-widest text-meta">
          confidence
        </span>
      </div>
      <div className="relative mt-2 h-0.5 w-full bg-hairline">
        <div
          className={cn("absolute inset-y-0 left-0", color)}
          style={{ width: `${confidence}%` }}
        />
        {[50, 70, 85, 95].map((tick) => (
          <span
            key={tick}
            className="absolute top-[-3px] h-2 w-px bg-meta/50"
            style={{ left: `${tick}%` }}
            aria-hidden
          />
        ))}
      </div>
      <p className="mt-2 text-meta text-ink-2">{bandLabel(confidence)}</p>
    </div>
  );
}
