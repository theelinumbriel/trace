import { NextResponse } from "next/server";
import { normalizeGtin } from "@/lib/gtin";
import { AppError, invalidBarcode, toResponse } from "@/lib/errors";
import { readProductLive } from "@/lib/queries";
import { zProductResponse } from "@/lib/schemas/api";

/** GET /api/products/[gtin] — cached identity + trace summary. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gtin: string }> },
) {
  try {
    const { gtin } = await params;
    const normalized = normalizeGtin(gtin);
    if (!normalized) throw invalidBarcode();

    const data = await readProductLive(normalized.gtin14);
    if (!data) {
      throw new AppError(
        "NOT_FOUND",
        404,
        "We don't know this product yet — scan it or run a lookup first.",
      );
    }
    const response = zProductResponse.parse({
      product: data.product,
      trace: data.trace,
    });
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
