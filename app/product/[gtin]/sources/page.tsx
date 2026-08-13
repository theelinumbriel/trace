import { Suspense } from "react";
import { notFound } from "next/navigation";
import { normalizeGtin } from "@/lib/gtin";
import { getSources } from "@/lib/engine/sources";
import type { SourceCard } from "@/lib/schemas/api";
import { EvidenceCardView } from "@/components/trace/evidence-card";
import { Skeleton } from "@/components/ui/skeleton";

async function SourcesList({ gtin }: { gtin: string }) {
  const normalized = normalizeGtin(gtin);
  if (!normalized) notFound();
  const sources = await getSources(normalized.gtin14);
  if (sources === null) notFound();

  if (sources.length === 0) {
    return (
      <div className="py-16">
        <p className="text-title-2 text-ink">No public sources yet.</p>
        <p className="mt-2 max-w-md text-meta text-ink-2">
          Trace queries Open Food Facts, USDA FoodData Central, openFDA
          enforcement reports, and curated corporate disclosures. None of them
          has records for this product yet — its trace will show Unknown
          stages rather than guesses.
        </p>
      </div>
    );
  }

  // Group by the claims each source supports; a source supporting several
  // claims appears under each, labeled with its total.
  const groups = new Map<string, SourceCard[]>();
  for (const card of sources) {
    const titles =
      card.claimsSupported.length > 0
        ? card.claimsSupported.map((c) => c.title)
        : ["Other"];
    for (const title of titles) {
      groups.set(title, [...(groups.get(title) ?? []), card]);
    }
  }
  const identityFirst = [...groups.entries()].sort(([a], [b]) =>
    a === "Product identity" ? -1 : b === "Product identity" ? 1 : 0,
  );

  return (
    <div className="space-y-10 py-8">
      {identityFirst.map(([title, cards]) => (
        <section key={title}>
          <h2 className="text-micro font-medium uppercase tracking-widest text-meta">
            {title}
          </h2>
          <div className="mt-3 space-y-3">
            {cards.map((card) => (
              <div key={`${title}-${card.id}`}>
                <EvidenceCardView card={card} />
                {card.claimsSupported.length > 1 && (
                  <p className="mt-1 text-micro text-meta">
                    Supports {card.claimsSupported.length} claims
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

async function SourcesInner({
  params,
}: {
  params: Promise<{ gtin: string }>;
}) {
  const { gtin } = await params;
  return <SourcesList gtin={gtin} />;
}

export default function SourcesPage(
  props: PageProps<"/product/[gtin]/sources">,
) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 py-8">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      }
    >
      <SourcesInner params={props.params} />
    </Suspense>
  );
}
