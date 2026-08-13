import { Suspense } from "react";
import {
  ProductHeader,
  ProductHeaderSkeleton,
} from "@/components/product/product-header";
import { TabNav } from "@/components/product/tab-nav";

async function LayoutInner({
  params,
  children,
}: {
  params: Promise<{ gtin: string }>;
  children: React.ReactNode;
}) {
  const { gtin } = await params;
  return (
    <>
      <Suspense fallback={<ProductHeaderSkeleton />}>
        <ProductHeader gtin={gtin} />
      </Suspense>
      <TabNav gtin={gtin} />
      {children}
    </>
  );
}

export default function ProductLayout({
  params,
  children,
}: LayoutProps<"/product/[gtin]">) {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 md:px-8">
      <Suspense fallback={<ProductHeaderSkeleton />}>
        <LayoutInner params={params}>{children}</LayoutInner>
      </Suspense>
    </div>
  );
}
