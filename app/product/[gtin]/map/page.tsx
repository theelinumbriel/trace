import { Suspense } from "react";
import { MapTab } from "@/components/map/map-tab";
import { Skeleton } from "@/components/ui/skeleton";

async function MapInner({
  params,
  searchParams,
}: {
  params: Promise<{ gtin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gtin } = await params;
  const sp = await searchParams;
  const lot = typeof sp.lot === "string" ? sp.lot : null;
  return <MapTab gtin={gtin} lot={lot} />;
}

export default function MapPage(props: PageProps<"/product/[gtin]/map">) {
  return (
    <Suspense fallback={<Skeleton className="mt-8 h-[420px] w-full" />}>
      <MapInner params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
