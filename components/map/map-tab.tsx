"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { TraceEvent } from "@/lib/schemas/api";
import { useTrace } from "@/components/trace/use-trace";
import { TraceProgress } from "@/components/trace/trace-progress";
import { EvidenceDrawer } from "@/components/trace/evidence-drawer";
import { StatusGlyph } from "@/components/trace/status-glyph";
import { Spinner } from "@/components/ui/spinner";
import {
  readStoredLocality,
  type StoredLocality,
} from "@/components/trace/scan-node";
import { buildPoints } from "./route-map";

const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 bg-wash">
      <Spinner className="h-4 w-4" />
      <span className="text-meta text-ink-2">Preparing map</span>
    </div>
  ),
});

function webgl2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

/** All information, no theatre: the located-list fallback. */
function MapUnavailable({
  events,
  reason,
}: {
  events: TraceEvent[];
  reason: string;
}) {
  return (
    <div className="py-8">
      <p className="text-title-2 text-ink">The map can&apos;t load here.</p>
      <p className="mt-1 text-meta text-ink-2">{reason}</p>
      <ol className="mt-6 space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-3">
            <span className="font-mono text-meta tabular-nums text-meta">
              {String(e.seq).padStart(2, "0")}
            </span>
            <StatusGlyph status={e.status} size={16} />
            <span className="text-body text-ink">{e.locationLabel}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MapTab({ gtin, lot }: { gtin: string; lot: string | null }) {
  const { view, running } = useTrace(gtin, lot);
  const [selected, setSelected] = useState<TraceEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Lazy init: this component renders only after client-side data loads,
  // so reading browser state during render can't mismatch SSR HTML.
  const [scan] = useState<StoredLocality | null>(() =>
    typeof window === "undefined" ? null : readStoredLocality(),
  );
  const [webgl] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : webgl2Available(),
  );

  if (running || !view) {
    return (
      <div className="py-8">
        <TraceProgress
          steps={
            view?.pipeline ?? [
              { key: "identify", label: "Product identified", state: "active" },
            ]
          }
        />
      </div>
    );
  }

  const located = buildPoints(view.events, scan);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (located.length < 2) {
    return (
      <MapUnavailable
        events={view.events}
        reason="Not enough located evidence to draw a route — stages without a known place stay honest instead of being pinned somewhere plausible."
      />
    );
  }
  if (!token) {
    return (
      <MapUnavailable
        events={view.events}
        reason="Map tiles are not configured (missing Mapbox token). Every located stage is listed below."
      />
    );
  }
  if (webgl === false) {
    return (
      <MapUnavailable
        events={view.events}
        reason="This browser doesn't support WebGL2. Every located stage is listed below."
      />
    );
  }

  return (
    <div className="relative -mx-5 h-[calc(100dvh-16rem)] min-h-[420px] md:-mx-8">
      <RouteMap
        events={view.events}
        scan={scan}
        onSelect={(e) => {
          setSelected(e);
          setDrawerOpen(true);
        }}
      />
      <EvidenceDrawer
        event={selected}
        isBatch={view.kind === "batch"}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
