"use client";

import { useEffect, useState } from "react";
import type { TraceEvent } from "@/lib/schemas/api";
import { StatusGlyph, STATUS_LABEL } from "@/components/trace/status-glyph";
import { ConfidenceMeter } from "@/components/trace/confidence-meter";
import { EvidenceCardView } from "@/components/trace/evidence-card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function DrawerBody({ event, isBatch }: { event: TraceEvent; isBatch: boolean }) {
  return (
    <div className="space-y-6 px-1 pb-8">
      <ConfidenceMeter confidence={event.confidence} status={event.status} />

      <section>
        <p className="text-micro font-medium uppercase tracking-widest text-meta">
          Why we think this
        </p>
        <p className="mt-2 text-body leading-relaxed text-ink">
          {event.status === "inferred" && (
            <>
              <strong>Inferred.</strong> No direct record documents this step.{" "}
            </>
          )}
          {event.evidenceSummary}
        </p>
        {event.status === "inferred" && event.inferenceBasis && (
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            Basis: {event.inferenceBasis}
          </p>
        )}
      </section>

      {event.evidence.length > 0 && (
        <section className="space-y-3">
          <p className="text-micro font-medium uppercase tracking-widest text-meta">
            Supporting evidence
          </p>
          {event.evidence.map((card) => (
            <EvidenceCardView key={card.id} card={card} />
          ))}
        </section>
      )}

      {/* Explicit uncertainty statement — always present. */}
      {event.status === "inferred" && (
        <p className="border-l-2 border-inferred bg-inferred-tint/60 px-3 py-2 text-meta leading-relaxed text-ink-2">
          We have evidence supporting this route, but cannot verify that an
          individual unit traveled it. Alternative routings consistent with
          the same records are possible.
        </p>
      )}
      {(event.status === "verified" || event.status === "documented") &&
        !isBatch && (
          <p className="border-l-2 border-hairline bg-wash px-3 py-2 text-meta leading-relaxed text-ink-2">
            {STATUS_LABEL[event.status]} for this product type, not this
            specific unit.
          </p>
        )}
      {event.status === "unknown" && (
        <p className="border-l-2 border-hairline bg-wash px-3 py-2 text-meta leading-relaxed text-ink-2">
          Unknown is shown deliberately: no source we query supports a claim
          here, and Trace does not guess.
        </p>
      )}
    </div>
  );
}

export function EvidenceDrawer({
  event,
  isBatch,
  open,
  onOpenChange,
}: {
  event: TraceEvent | null;
  isBatch: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  if (!event) return null;

  const header = (
    <div className="flex items-center gap-2.5">
      <StatusGlyph status={event.status} size={24} />
      <div>
        <p className="text-micro font-medium uppercase tracking-widest text-meta">
          {event.title}
        </p>
        <p className="text-title-2 text-ink">{event.locationLabel}</p>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle asChild>
              <div>{header}</div>
            </SheetTitle>
            <SheetDescription className="sr-only">
              Evidence for {event.locationLabel}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-[calc(100dvh-7rem)] px-4">
            <DrawerBody event={event} isBatch={isBatch} />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left">
          <DrawerTitle asChild>
            <div>{header}</div>
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Evidence for {event.locationLabel}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-safe-4">
          <DrawerBody event={event} isBatch={isBatch} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
