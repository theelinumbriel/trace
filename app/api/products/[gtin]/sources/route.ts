import { NextResponse } from "next/server";
import { normalizeGtin } from "@/lib/gtin";
import { AppError, invalidBarcode, toResponse } from "@/lib/errors";
import { getSources } from "@/lib/engine/sources";
import { zSourcesResponse } from "@/lib/schemas/api";

/**
 * GET /api/products/[gtin]/sources — every evidence row used to construct
 * the trace, with the claims each supports.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gtin: string }> },
) {
  try {
    const { gtin } = await params;
    const normalized = normalizeGtin(gtin);
    if (!normalized) throw invalidBarcode();

    const sources = await getSources(normalized.gtin14);
    if (sources === null)
      throw new AppError("NOT_FOUND", 404, "Unknown product.");

    return NextResponse.json(zSourcesResponse.parse({ sources }), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
