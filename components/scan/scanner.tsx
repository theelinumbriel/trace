"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flashlight, Keyboard, X } from "lucide-react";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { readStoredLocality } from "@/components/trace/scan-node";
import { useScanner, type Detection } from "./use-scanner";
import { ManualEntryForm } from "./manual-entry";
import { cn } from "@/lib/utils";

type LookupPhase =
  | { kind: "idle" }
  | { kind: "loading"; gtin: string }
  | { kind: "no_match" }
  | { kind: "invalid" };

export function Scanner() {
  const router = useRouter();
  const [flash, setFlash] = useState(false);
  const [chip, setChip] = useState<string | null>(null);
  const [phase, setPhase] = useState<LookupPhase>({ kind: "idle" });
  const [manualOpen, setManualOpen] = useState(false);
  const [batchChip, setBatchChip] = useState(false);
  const invalidAt = useRef(0);

  const onInvalid = useCallback(() => {
    const now = Date.now();
    if (now - invalidAt.current < 2500) return;
    invalidAt.current = now;
    setPhase({ kind: "invalid" });
    setTimeout(() => setPhase({ kind: "idle" }), 1800);
  }, []);

  const onDetect = useCallback(
    async (d: Detection) => {
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
      setChip(d.parsed.gtin14);
      setBatchChip(d.parsed.isBatch);
      haptics.tick();
      setPhase({ kind: "loading", gtin: d.parsed.gtin14 });

      const locality = readStoredLocality();
      try {
        const res = await fetch("/api/products/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: d.rawValue,
            symbology: d.symbology,
            ...(locality
              ? {
                  locality: locality.label,
                  approxLat: locality.lat,
                  approxLng: locality.lng,
                }
              : {}),
          }),
        });
        if (res.ok) {
          haptics.success();
          setTimeout(() => {
            router.push(
              `/product/${d.parsed.gtin14}${
                d.parsed.lot ? `?lot=${encodeURIComponent(d.parsed.lot)}` : ""
              }`,
            );
          }, 250);
          return;
        }
        if (res.status === 404) {
          setPhase({ kind: "no_match" });
          setTimeout(() => {
            setPhase({ kind: "idle" });
            setChip(null);
            setBatchChip(false);
            resume();
          }, 2600);
          return;
        }
        throw new Error(`lookup ${res.status}`);
      } catch {
        toast("You're offline — reconnect and try again.");
        setPhase({ kind: "idle" });
        setChip(null);
        resume();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  const {
    videoRef,
    state,
    start,
    resume,
    stop,
    torchAvailable,
    torchOn,
    toggleTorch,
  } = useScanner(onDetect, onInvalid);

  useEffect(() => {
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanning = state === "scanning" || state === "detected";

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Live announcements for screen readers. */}
      <p aria-live="polite" className="sr-only">
        {state === "scanning" && "Camera active. Point at a barcode."}
        {phase.kind === "loading" &&
          `Barcode ${chip} detected. Loading product.`}
        {phase.kind === "no_match" && "No product found for this barcode."}
      </p>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full object-cover"
      />

      {/* Detect flash */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-white transition-opacity duration-150",
          flash ? "opacity-70" : "opacity-0",
        )}
      />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-safe">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close scanner"
          className="mt-2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
          onClick={() => router.push("/")}
        >
          <X strokeWidth={1.5} />
        </Button>
        {torchAvailable && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
            aria-pressed={torchOn}
            className={cn(
              "mt-2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white",
              torchOn && "bg-white/90 text-black hover:bg-white",
            )}
            onClick={toggleTorch}
          >
            <Flashlight strokeWidth={1.5} />
          </Button>
        )}
      </div>

      {/* Reticle */}
      {scanning && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 aspect-[4/3] w-[78%] max-w-md -translate-x-1/2 -translate-y-1/2 transition-transform duration-150",
            state === "detected" && "scale-95",
          )}
        >
          {(["-top-px -left-px border-t border-l", "-top-px -right-px border-t border-r", "-bottom-px -left-px border-b border-l", "-bottom-px -right-px border-b border-r"] as const).map(
            (pos) => (
              <span
                key={pos}
                className={cn(
                  "absolute h-7 w-7 rounded-[2px] border-white/90",
                  pos,
                )}
              />
            ),
          )}
        </div>
      )}

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-6 pb-safe-4 pt-16 text-center">
        {chip && (
          <span className="rounded-full bg-white/95 px-4 py-1.5 font-mono text-meta font-medium tabular-nums text-black">
            {chip}
            {batchChip && (
              <span className="ml-2 text-micro font-semibold uppercase tracking-widest text-inferred">
                Batch data detected
              </span>
            )}
          </span>
        )}
        {phase.kind === "no_match" ? (
          <p className="max-w-xs text-meta text-white/90">
            Valid code, but no product data in any source we query. Non-food
            coverage is limited.
          </p>
        ) : phase.kind === "invalid" ? (
          <p className="max-w-xs text-meta text-white/90">
            That code didn&apos;t read cleanly — try again.
          </p>
        ) : phase.kind === "loading" ? (
          <p className="text-meta text-white/90">Looking up…</p>
        ) : (
          <>
            <p className="text-body font-medium text-white">
              Scan a product barcode
            </p>
            <p className="max-w-xs text-meta text-white/80">
              Point your camera at a UPC, EAN, QR, or GS1 code.
            </p>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-1 rounded-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
          onClick={() => setManualOpen(true)}
        >
          <Keyboard strokeWidth={1.5} data-slot="icon" />
          Type it instead
        </Button>
      </div>

      {/* Permission denied */}
      {state === "denied" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-8 text-center">
          <p className="text-title-2 text-white">Camera access is off.</p>
          <div className="max-w-sm space-y-2 text-meta text-white/80">
            <p>
              iPhone Safari: tap <strong>aA</strong> in the address bar →
              Website Settings → Camera → Allow.
            </p>
            <p>
              Android Chrome: tap the lock icon → Permissions → Camera →
              Allow.
            </p>
          </div>
          <div className="mt-2 flex gap-3">
            <Button className="rounded-full" onClick={() => start()}>
              Try again
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => setManualOpen(true)}
            >
              Type it instead
            </Button>
          </div>
        </div>
      )}

      {/* No camera / unsupported (the desktop testing path) */}
      {state === "unsupported" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-6">
          <div className="w-full max-w-sm rounded-xl bg-paper p-6">
            <p className="text-title-2 text-ink">No camera here.</p>
            <p className="mt-1 text-meta text-ink-2">
              Enter a barcode number instead, or try the{" "}
              <Link href="/codes" className="underline underline-offset-2">
                seeded test codes
              </Link>
              .
            </p>
            <div className="mt-4">
              <ManualEntryForm autoFocus />
            </div>
          </div>
        </div>
      )}

      <Drawer open={manualOpen} onOpenChange={setManualOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Enter a barcode</DrawerTitle>
            <DrawerDescription>
              The number printed under the bars.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-safe-4">
            <ManualEntryForm
              autoFocus
              onNavigate={() => setManualOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
