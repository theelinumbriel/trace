"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-20 md:px-8">
      <AlertTriangle className="h-8 w-8 text-meta" strokeWidth={1.25} />
      <h1 className="mt-4 text-title-1 text-ink">
        We couldn&apos;t load this product right now.
      </h1>
      <p className="mt-3 max-w-md text-body text-ink-2">
        The data sources we query may be unreachable. Nothing is wrong with
        the barcode — try again in a moment.
      </p>
      <Button className="mt-6 rounded-full" onClick={reset}>
        <RotateCcw strokeWidth={1.5} data-slot="icon" />
        Try again
      </Button>
    </div>
  );
}
