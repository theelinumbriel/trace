import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { scans, traces } from "@/db/schema";
import { parseScanValue } from "@/lib/gtin";
import { invalidBarcode, noMatch, toResponse, upstreamUnavailable } from "@/lib/errors";
import {
  getOrCreateProduct,
  UpstreamUnavailableError,
} from "@/lib/engine/identity";
import { zLookupRequest, zLookupResponse } from "@/lib/schemas/api";

/**
 * POST /api/products/lookup — resolve a raw scan/paste value to a product.
 * Side effects: persists a scans row (even for misses — coverage signal)
 * and warms the product row on first sight.
 */
export async function POST(req: Request) {
  try {
    const body = zLookupRequest.safeParse(await req.json());
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
    const { code, symbology, locality, approxLat, approxLng } = body.data;

    const parsed = parseScanValue(code);
    if (!parsed) throw invalidBarcode();

    const db = await getDb();

    let resolved;
    try {
      resolved = await getOrCreateProduct(parsed.gtin14);
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) throw upstreamUnavailable();
      throw err;
    }

    // Record the scan regardless of resolution (future coverage signal).
    await db.insert(scans).values({
      gtin: parsed.gtin14,
      productId: resolved?.product.id ?? null,
      rawValue: code.slice(0, 400),
      symbology,
      aiData: parsed.ais,
      lotCode: parsed.lot,
      locality: locality ?? null,
      approxLat: approxLat ?? null,
      approxLng: approxLng ?? null,
    });

    if (!resolved) throw noMatch();

    const [trace] = await db
      .select({ status: traces.status })
      .from(traces)
      .where(
        parsed.isBatch && parsed.lot
          ? and(
              eq(traces.productId, resolved.product.id),
              eq(traces.kind, "batch"),
              eq(traces.lotCode, parsed.lot),
            )
          : and(
              eq(traces.productId, resolved.product.id),
              eq(traces.kind, "product"),
            ),
      )
      .limit(1);

    const response = zLookupResponse.parse({
      product: {
        gtin: resolved.product.gtin,
        upc: resolved.product.upc,
        name: resolved.product.name,
        brand: resolved.brandName,
        category: resolved.product.category,
        imageUrl: resolved.product.imageUrl,
        description: resolved.product.description,
        ingredientsText: resolved.product.ingredientsText,
      },
      gtin14: parsed.gtin14,
      mode: parsed.isBatch ? "batch" : "product",
      batch: parsed.isBatch
        ? {
            lot: parsed.lot,
            serial: parsed.serial,
            expiryDate: parsed.expiryDate,
          }
        : null,
      traceState: trace?.status ?? null,
    });
    return NextResponse.json(response);
  } catch (err) {
    return toResponse(err);
  }
}
