"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = { key: string; label: string; state: string };

/**
 * The live "Tracing this product" checklist. Process state uses ink, not
 * evidence green — the status grammar is reserved for claims.
 */
export function TraceProgress({ steps }: { steps: Step[] }) {
  return (
    <section aria-live="polite" className="py-8">
      <h2 className="text-title-2 text-ink">Tracing this product</h2>
      <ul className="mt-5 space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            <span className="flex h-5 w-5 items-center justify-center">
              {step.state === "done" && (
                <Check className="h-4 w-4 text-ink" strokeWidth={2} />
              )}
              {step.state === "failed" && (
                <X className="h-4 w-4 text-danger" strokeWidth={2} />
              )}
              {step.state === "active" && (
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-ink" />
              )}
              {(step.state === "pending" || step.state === "skipped") && (
                <span className="h-2.5 w-2.5 rounded-full border border-hairline" />
              )}
            </span>
            <span
              className={cn(
                "text-body",
                step.state === "done" && "text-ink",
                step.state === "active" && "text-ink font-medium",
                step.state === "failed" && "text-danger",
                (step.state === "pending" || step.state === "skipped") &&
                  "text-meta",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
