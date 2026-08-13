"use client";

import { ChevronRight } from "lucide-react";
import type { TraceEvent } from "@/lib/schemas/api";
import { StatusGlyph } from "@/components/trace/status-glyph";
import { cn } from "@/lib/utils";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function statusLine(e: TraceEvent): string {
  switch (e.status) {
    case "verified":
      return "Verified";
    case "documented":
      return "Documented";
    case "inferred":
      return `Inferred · ${e.confidence}%`;
    case "unknown":
      return "Unknown";
    case "observed":
      return "Observed";
  }
}

const STATUS_TEXT: Record<TraceEvent["status"], string> = {
  verified: "text-verified",
  documented: "text-ink",
  inferred: "text-inferred",
  unknown: "text-meta",
  observed: "text-ink",
};

function Connector({ dashed }: { dashed: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "mx-auto min-h-6 flex-1",
        dashed
          ? "w-0 border-l border-dashed border-hairline"
          : "w-px bg-hairline",
      )}
    />
  );
}

function NodeContent({ event }: { event: TraceEvent }) {
  const unknown = event.status === "unknown";
  return (
    <div
      className={cn(
        "min-w-0 flex-1 pb-8",
        unknown &&
          "rounded-lg border border-dashed border-hairline bg-wash/60 p-4 pb-4",
      )}
    >
      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        {event.title}
      </p>
      <p className="mt-0.5 text-title-2 text-ink">{event.locationLabel}</p>
      <p
        className={cn(
          "mt-1 text-meta font-medium",
          STATUS_TEXT[event.status],
          event.status === "inferred" && "font-mono tabular-nums",
        )}
      >
        {statusLine(event)}
      </p>
      {unknown ? (
        <p className="mt-2 text-meta leading-relaxed text-ink-2">
          <strong className="text-ink">We don&apos;t know.</strong>{" "}
          {event.evidenceSummary}
        </p>
      ) : (
        <p className="mt-1 text-mono-data text-meta">
          {[
            event.dateRange,
            event.evidence.length > 0
              ? `${event.evidence.length} source${event.evidence.length > 1 ? "s" : ""}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {event.illustrative && (
        <p className="mt-1 text-micro font-medium uppercase tracking-widest text-inferred">
          Includes illustrative records
        </p>
      )}
    </div>
  );
}

export function JourneyTimeline({
  events,
  onSelect,
  terminal,
}: {
  events: TraceEvent[];
  onSelect: (event: TraceEvent) => void;
  /** The "Your scan" node rendered after the last event. */
  terminal?: React.ReactNode;
}) {
  const dashedAfter = (i: number): boolean => {
    const a = events[i];
    const b = events[i + 1];
    const soft = (s: TraceEvent["status"]) =>
      s === "inferred" || s === "unknown";
    if (!b) return a ? soft(a.status) : false;
    return soft(a.status) || soft(b.status);
  };

  return (
    <ol className="mt-2">
      {events.map((event, i) => (
        <li
          key={event.id}
          className="grid grid-cols-[44px_1fr] gap-x-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
          style={{ animationDelay: `${Math.min(i * 60, 480)}ms` }}
        >
          <div className="flex flex-col items-center">
            <span className="font-mono text-title-2 tabular-nums text-ink">
              {pad(event.seq)}
            </span>
            <div className="mt-1.5">
              <StatusGlyph status={event.status} size={20} />
            </div>
            {(i < events.length - 1 || terminal) && (
              <Connector dashed={dashedAfter(i)} />
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelect(event)}
            aria-haspopup="dialog"
            className="group flex min-h-14 items-start gap-2 text-left"
          >
            <NodeContent event={event} />
            <ChevronRight
              className="mt-8 h-4 w-4 shrink-0 text-ink/40 transition-transform group-hover:translate-x-0.5"
              strokeWidth={1.5}
            />
          </button>
        </li>
      ))}
      {terminal}
    </ol>
  );
}

/** Left-rail wrapper for the terminal scan node, matching event nodes. */
export function TerminalNode({
  seq,
  children,
}: {
  seq: number;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[44px_1fr] gap-x-3">
      <div className="flex flex-col items-center">
        <span className="font-mono text-title-2 tabular-nums text-ink">
          {pad(seq)}
        </span>
        <div className="mt-1.5">
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-ink/20 motion-reduce:hidden" />
            <StatusGlyph status="observed" size={20} />
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1 pb-2">{children}</div>
    </li>
  );
}
