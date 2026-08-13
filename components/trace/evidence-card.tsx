import { ArrowUpRight } from "lucide-react";
import type { EvidenceCard as EvidenceCardT } from "@/lib/schemas/api";
import { Badge } from "@/components/ui/badge";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  product_database: "Open database",
  manufacturer_disclosure: "Manufacturer disclosure",
  sustainability_report: "Sustainability report",
  certification: "Certification",
  government_record: "Government record",
  recall_database: "Recall database",
  customs_record: "Trade record",
  gs1_registry: "GS1 registry",
  traceability_system: "Direct traceability",
  news_media: "News media",
  retailer_listing: "Retailer listing",
  other: "Reference",
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return m ? `${months[Number(m) - 1]} ${y}` : y;
}

export function EvidenceCardView({ card }: { card: EvidenceCardT }) {
  const published = fmtDate(card.publicationDate);
  const retrieved = fmtDate(card.retrievedAt.slice(0, 10));
  return (
    <article className="rounded-lg border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-body font-medium text-ink">{card.sourceName}</p>
        <Badge variant="outline" className="shrink-0 text-micro uppercase">
          {SOURCE_TYPE_LABEL[card.sourceType] ?? card.sourceType}
        </Badge>
      </div>
      <p className="mt-0.5 text-meta text-ink-2">{card.title}</p>
      <p className="mt-1 text-mono-data text-meta">
        {published ? `Published ${published} · ` : ""}Retrieved {retrieved}
      </p>
      <blockquote className="mt-3 border-l-2 border-ink bg-wash px-3 py-2 text-meta leading-relaxed text-ink-2">
        {card.supportingText.length > 280
          ? `${card.supportingText.slice(0, 280)}…`
          : card.supportingText}
      </blockquote>
      {card.mock && (
        <p className="mt-2 text-micro font-medium uppercase tracking-widest text-inferred">
          Illustrative — commercial data source not connected
        </p>
      )}
      {card.needsVerification && (
        <p className="mt-2 text-micro font-medium uppercase tracking-widest text-meta">
          Excerpt pending re-verification
        </p>
      )}
      <a
        href={card.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-meta font-medium text-ink underline underline-offset-2 hover:text-ink-2"
      >
        View source
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </a>
      {card.license && (
        <span className="ml-3 text-micro text-meta">({card.license})</span>
      )}
    </article>
  );
}
