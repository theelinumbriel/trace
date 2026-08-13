"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Map, {
  Layer,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/mapbox";
import greatCircle from "@turf/great-circle";
import type { Feature, LineString, MultiLineString } from "geojson";
import type { TraceEvent } from "@/lib/schemas/api";
import type { StoredLocality } from "@/components/trace/scan-node";
import { cn } from "@/lib/utils";
import "mapbox-gl/dist/mapbox-gl.css";

const INK = "#161513";
const AMBER = "#9A6200";

export type MapPoint = {
  event: TraceEvent | null; // null = scan point
  label: string;
  seq: number;
  lat: number;
  lng: number;
  soft: boolean; // inferred/unknown styling
};

export function buildPoints(
  events: TraceEvent[],
  scan: StoredLocality | null,
): MapPoint[] {
  const located: MapPoint[] = events
    .filter((e) => e.lat !== null && e.lng !== null)
    .map((e) => ({
      event: e,
      label: e.locationLabel,
      seq: e.seq,
      lat: e.lat as number,
      lng: e.lng as number,
      soft: e.status === "inferred" || e.status === "unknown",
    }));
  if (scan) {
    located.push({
      event: null,
      label: scan.label,
      seq: (events.at(-1)?.seq ?? located.length) + 1,
      lat: scan.lat,
      lng: scan.lng,
      soft: false,
    });
  }
  return located;
}

type Leg = {
  index: number;
  soft: boolean;
  feature: Feature<LineString | MultiLineString>;
};

function buildLegs(points: MapPoint[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const arc = greatCircle([a.lng, a.lat], [b.lng, b.lat], { npoints: 64 });
    legs.push({
      index: i,
      // A leg is only as solid as its shakier endpoint.
      soft: a.soft || b.soft || a.event === null || b.event === null
        ? (a.event?.status === "inferred" ||
            a.event?.status === "unknown" ||
            b.event?.status === "inferred" ||
            b.event?.status === "unknown")
        : false,
      feature: arc as Feature<LineString | MultiLineString>,
    });
  }
  return legs;
}

const LEG_MS = 900;

export default function RouteMap({
  events,
  scan,
  onSelect,
}: {
  events: TraceEvent[];
  scan: StoredLocality | null;
  onSelect: (event: TraceEvent) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const points = useMemo(() => buildPoints(events, scan), [events, scan]);
  const legs = useMemo(() => buildLegs(points), [points]);

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    let minLat = 90,
      maxLat = -90,
      minLng = 180,
      maxLng = -180;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ] as [[number, number], [number, number]];
  }, [points]);

  // Sequential reveal: one rAF loop drives every leg — solid legs advance a
  // line-gradient head, soft (inferred/unknown) legs fade in dashed amber.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || legs.length === 0) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let start: number | null = null;
    let cancelled = false;

    const paint = (now: number) => {
      if (cancelled) return;
      if (start === null) start = now;
      const elapsed = now - start;
      let allDone = true;
      for (const leg of legs) {
        const layerId = leg.soft ? `leg-soft-${leg.index}` : `leg-${leg.index}`;
        if (!map.getLayer(layerId)) continue;
        const t = reduced
          ? 1
          : Math.min(Math.max((elapsed - leg.index * LEG_MS) / LEG_MS, 0), 1);
        if (t < 1) allDone = false;
        if (leg.soft) {
          map.setPaintProperty(layerId, "line-opacity", 0.6 * t);
        } else {
          const head = Math.max(t, 0.0001);
          map.setPaintProperty(layerId, "line-gradient", [
            "step",
            ["line-progress"],
            INK,
            head,
            "rgba(0,0,0,0)",
          ]);
        }
      }
      if (!allDone && !reduced) raf = requestAnimationFrame(paint);
    };

    const kick = () => {
      raf = requestAnimationFrame(paint);
    };
    if (map.isStyleLoaded()) kick();
    else map.once("idle", kick);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(paint);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [legs]);

  if (points.length === 0) return null;

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      mapStyle="mapbox://styles/mapbox/light-v11"
      initialViewState={
        bounds
          ? { bounds, fitBoundsOptions: { padding: 64, maxZoom: 6 } }
          : { longitude: -40, latitude: 35, zoom: 1.5 }
      }
      style={{ width: "100%", height: "100%" }}
      attributionControl={true}
      maxPitch={0}
      dragRotate={false}
      onRemove={() => undefined}
    >
      {/* Base: every leg, thin ink at low opacity — the full route on record. */}
      {legs.map((leg) => (
        <Source
          key={`base-${leg.index}`}
          id={`base-src-${leg.index}`}
          type="geojson"
          data={leg.feature}
          lineMetrics
        >
          <Layer
            id={`base-${leg.index}`}
            type="line"
            paint={{
              "line-color": INK,
              "line-width": 1.25,
              "line-opacity": 0.18,
            }}
          />
          {leg.soft ? (
            <Layer
              id={`leg-soft-${leg.index}`}
              type="line"
              paint={{
                "line-color": AMBER,
                "line-width": 1.25,
                "line-dasharray": [2, 3],
                "line-opacity": 0,
              }}
            />
          ) : (
            <Layer
              id={`leg-${leg.index}`}
              type="line"
              paint={{
                "line-color": INK,
                "line-width": 1.5,
                "line-gradient": [
                  "step",
                  ["line-progress"],
                  "rgba(0,0,0,0)",
                  0.0001,
                  "rgba(0,0,0,0)",
                ],
              }}
            />
          )}
        </Source>
      ))}

      {points.map((p) => (
        <Marker
          key={p.seq}
          longitude={p.lng}
          latitude={p.lat}
          anchor="center"
          onClick={() => {
            setSelectedSeq(p.seq);
            if (p.event) onSelect(p.event);
          }}
        >
          {p.event === null ? (
            <span className="relative flex h-5 w-5 items-center justify-center">
              <span className="absolute h-4 w-4 animate-ping rounded-full bg-ink/25 motion-reduce:hidden" />
              <span className="h-2.5 w-2.5 rounded-full bg-ink ring-2 ring-paper" />
            </span>
          ) : (
            <button
              type="button"
              aria-label={`${p.seq}. ${p.label}`}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums shadow-drawer transition-transform hover:scale-110",
                p.event.status === "inferred"
                  ? "border border-inferred bg-paper text-inferred"
                  : p.event.status === "unknown"
                    ? "border border-dashed border-unknown bg-paper text-unknown"
                    : "bg-ink text-paper",
                selectedSeq === p.seq && "ring-2 ring-ink/40",
              )}
            >
              {String(p.seq).padStart(2, "0")}
            </button>
          )}
        </Marker>
      ))}

      {/* Legend */}
      <div className="absolute bottom-8 left-3 rounded-md border border-hairline bg-paper/90 px-2.5 py-1.5 text-micro text-ink-2 backdrop-blur">
        <span className="mr-3">— on record</span>
        <span className="text-inferred">- - inferred</span>
      </div>
    </Map>
  );
}
