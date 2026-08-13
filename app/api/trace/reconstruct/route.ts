import { NextResponse, after } from "next/server";
import { normalizeGtin } from "@/lib/gtin";
import { invalidBarcode, noMatch, toResponse, upstreamUnavailable } from "@/lib/errors";
import {
  getOrCreateProduct,
  UpstreamUnavailableError,
} from "@/lib/engine/identity";
import { ensureTrace, reconstructSupplyChain } from "@/lib/engine/reconstruct";
import { zReconstructRequest } from "@/lib/schemas/api";

/**
 * POST /api/trace/reconstruct — enqueue/attach to a reconstruction.
 *   200 {traceId, fresh:true}  — a complete trace inside TRACE_TTL_HOURS
 *   202 {traceId}              — started, or already running (collapsed)
 * The pipeline itself runs post-response via after(); progress is read by
 * polling GET /api/products/[gtin]/trace.
 */
export const maxDuration = 300; // Vercel Hobby cap — pipeline runs in after()

export async function POST(req: Request) {
  try {
    const body = zReconstructRequest.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            retryable: false,
            issues: body.error.issues,
          },
        },
        { status: 400 },
      );
    }
    const { gtin, mode, lot, serial, expiryDate, force } = body.data;

    const normalized = normalizeGtin(gtin);
    if (!normalized) throw invalidBarcode();
    if (mode === "batch" && !lot && !serial) throw invalidBarcode();

    let resolved;
    try {
      resolved = await getOrCreateProduct(normalized.gtin14);
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) throw upstreamUnavailable();
      throw err;
    }
    if (!resolved) throw noMatch();

    const { traceId, fresh, started } = await ensureTrace({
      productId: resolved.product.id,
      kind: mode,
      lot: lot ?? null,
      serial: serial ?? null,
      expiryDate: expiryDate ?? null,
      force,
    });

    if (fresh) {
      return NextResponse.json({ traceId, fresh: true }, { status: 200 });
    }
    if (started) {
      after(async () => {
        await reconstructSupplyChain(traceId);
      });
    }
    return NextResponse.json({ traceId }, { status: 202 });
  } catch (err) {
    return toResponse(err);
  }
}
