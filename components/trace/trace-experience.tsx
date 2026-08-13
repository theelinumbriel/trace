"use client";

import { useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { TraceEvent, TraceView } from "@/lib/schemas/api";
import { PIPELINE_STEPS } from "@/db/json-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusGlyph } from "@/components/trace/status-glyph";
import { useTrace } from "./use-trace";
import { TraceProgress } from "./trace-progress";
import { JourneyTimeline, TerminalNode } from "./journey-timeline";
import { ScanNodeContent } from "./scan-node";
import { EvidenceDrawer } from "./evidence-drawer";

function TrustSummary({ view }: { view: TraceView }) {
  const parts = (
    [
      ["verified", view.counts.verified],
      ["documented", view.counts.documented],
      ["inferred", view.counts.inferred],
      ["unknown", view.counts.unknown],
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {parts.map(([status, n]) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <StatusGlyph status={status} size={16} />
          <span className="text-meta text-ink-2">
            {n} {status}
          </span>
        </span>
      ))}
    </div>
  );
}

export function TraceExperience({
  gtin,
  lot,
}: {
  gtin: string;
  lot: string | null;
}) {
  const { view, error, running, retry } = useTrace(gtin, lot);
  const [selected, setSelected] = useState<TraceEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const onSelect = (event: TraceEvent) => {
    setSelected(event);
    setDrawerOpen(true);
  };

  if (error && !view) {
    return (
      <Alert className="mt-8">
        <AlertTriangle strokeWidth={1.5} />
        <AlertTitle>
          {error === "offline"
            ? "You're offline — we'll keep trying"
            : "We couldn't start this trace"}
        </AlertTitle>
        <AlertDescription>
          <p>{error === "offline" ? "Reconnect and this will resume." : error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 rounded-full"
            onClick={retry}
          >
            <RotateCcw strokeWidth={1.5} data-slot="icon" />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (running) {
    const steps =
      view?.pipeline ??
      PIPELINE_STEPS.map((s) => ({
        key: s.key,
        label: s.label,
        state: "pending" as const,
      }));
    return (
      <div>
        <TraceProgress steps={steps} />
        {view && view.events.length > 0 && (
          <JourneyTimeline events={view.events} onSelect={onSelect} />
        )}
      </div>
    );
  }

  if (!view) return null;

  if (view.state === "failed") {
    return (
      <Alert className="mt-8">
        <AlertTriangle strokeWidth={1.5} />
        <AlertTitle>We couldn&apos;t build a trace right now</AlertTitle>
        <AlertDescription>
          <p>The reconstruction pipeline hit an error on our side.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 rounded-full"
            onClick={retry}
          >
            <RotateCcw strokeWidth={1.5} data-slot="icon" />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const isBatch = view.kind === "batch";
  const hasLotEvents = view.events.some((e) => e.lotCode);

  return (
    <div className="pb-4">
      <div className="flex flex-col gap-3 py-6">
        <TrustSummary view={view} />
        {view.state === "partial" && (
          <p className="border-l-2 border-inferred bg-inferred-tint/60 px-3 py-2 text-meta text-ink-2">
            Some sources were unreachable — this trace may be incomplete. It
            will refresh automatically after{" "}
            {process.env.NODE_ENV === "production" ? "a week" : "the TTL"}.
          </p>
        )}
        {isBatch && !hasLotEvents && (
          <p className="border-l-2 border-hairline bg-wash px-3 py-2 text-meta text-ink-2">
            No lot-specific records found for lot{" "}
            <span className="text-mono-data">{view.lotCode}</span> — showing
            the product-level chain.
            {view.expiryDate && (
              <>
                {" "}
                Expiry read from your code:{" "}
                <span className="text-mono-data">{view.expiryDate}</span>.
              </>
            )}
          </p>
        )}
      </div>

      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        Your product&apos;s journey
      </p>

      <JourneyTimeline
        events={view.events}
        onSelect={onSelect}
        terminal={
          <TerminalNode seq={view.events.length + 1}>
            <ScanNodeContent />
          </TerminalNode>
        }
      />

      {view.recalls.length > 0 && (
        <section className="mt-10">
          <p className="text-micro font-medium uppercase tracking-widest text-danger">
            Recall notices
          </p>
          <JourneyTimeline events={view.recalls} onSelect={onSelect} />
        </section>
      )}

      <EvidenceDrawer
        event={selected}
        isBatch={isBatch}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
