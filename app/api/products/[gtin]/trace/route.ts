import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { products, traces } from "@/db/schema";
import { normalizeGtin } from "@/lib/gtin";
import { AppError, invalidBarcode, toResponse } from "@/lib/errors";
import { serializeTrace } from "@/lib/engine/serialize";
import { zTraceView } from "@/lib/schemas/api";

/**
 * GET /api/products/[gtin]/trace — the polling target. Fully dynamic:
 * `pipeline` step states and `events` grow while reconstruction runs.
 * Optional ?lot= selects a batch trace.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ gtin: string }> },
) {
  try {
    const { gtin } = await params;
    const normalized = normalizeGtin(gtin);
    if (!normalized) throw invalidBarcode();
    const lot = new URL(req.url).searchParams.get("lot");

    const db = await getDb();
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.gtin, normalized.gtin14))
      .limit(1);
    if (!product) {
      throw new AppError("NOT_FOUND", 404, "Unknown product.");
    }

    const [trace] = await db
      .select({ id: traces.id })
      .from(traces)
      .where(
        lot
          ? and(
              eq(traces.productId, product.id),
              eq(traces.kind, "batch"),
              eq(traces.lotCode, lot),
            )
          : and(eq(traces.productId, product.id), eq(traces.kind, "product")),
      )
      .limit(1);
    if (!trace) {
      throw new AppError(
        "NOT_FOUND",
        404,
        "No trace yet for this product — kick one off via /api/trace/reconstruct.",
      );
    }

    const view = await serializeTrace(db, trace.id);
    if (!view) throw new AppError("NOT_FOUND", 404, "Trace vanished.");
    view.gtin = normalized.gtin14;

    return NextResponse.json(zTraceView.parse(view), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return toResponse(err);
  }
}
