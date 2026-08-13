import { Suspense } from "react";
import { TraceExperience } from "@/components/trace/trace-experience";
import { Skeleton } from "@/components/ui/skeleton";

async function JourneyInner({
  params,
  searchParams,
}: {
  params: Promise<{ gtin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gtin } = await params;
  const sp = await searchParams;
  const lot = typeof sp.lot === "string" ? sp.lot : null;
  return <TraceExperience gtin={gtin} lot={lot} />;
}

export default function JourneyPage(props: PageProps<"/product/[gtin]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 py-8">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
      }
    >
      <JourneyInner params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
