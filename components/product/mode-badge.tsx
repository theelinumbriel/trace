"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function ModeBadgeInner() {
  const searchParams = useSearchParams();
  const lot = searchParams.get("lot");

  return (
    <TooltipProvider>
      <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1.5 rounded-[2px] border border-ink px-1.5 py-0.5 font-mono text-micro font-medium uppercase tracking-widest text-ink">
          {lot ? (
            <>
              Batch trace
              <span className="text-meta">· lot {lot}</span>
            </>
          ) : (
            "Product trace"
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {lot
          ? "Item-level: built from the lot code in the code you scanned, on top of the product-level chain. Lot-specific claims appear only if records exist."
          : "Type-level: the best-supported chain for this product, not your individual item."}
      </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ModeBadge() {
  return (
    <Suspense
      fallback={
        <span className="inline-flex items-center rounded-[2px] border border-ink px-1.5 py-0.5 font-mono text-micro font-medium uppercase tracking-widest text-ink">
          Product trace
        </span>
      }
    >
      <ModeBadgeInner />
    </Suspense>
  );
}
