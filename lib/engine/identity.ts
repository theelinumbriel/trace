import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, products } from "@/db/schema";
import { canonicalKey, slugify } from "@/lib/canonical";
import { registry, fetchedRecently, recordFetch } from "@/providers/registry";
import type { ProductIdentity, RawObservation } from "@/providers/types";
import { persistEvidence } from "./persist";

export class UpstreamUnavailableError extends Error {
  constructor(public providers: string[]) {
    super(`all lookup providers unreachable: ${providers.join(", ")}`);
    this.name = "UpstreamUnavailableError";
  }
}

export type ResolvedProduct = {
  product: typeof products.$inferSelect;
  brandName: string | null;
  created: boolean;
  degraded: string[];
};

async function upsertCompany(
  name: string,
  companyType: (typeof companies.$inferInsert)["companyType"],
): Promise<string> {
  const db = await getDb();
  const slug = slugify(name);
  const [row] = await db
    .insert(companies)
    .values({ slug, name, canonicalKey: canonicalKey(name), companyType })
    .onConflictDoUpdate({
      target: companies.slug,
      set: { canonicalKey: canonicalKey(name) },
    })
    .returning({ id: companies.id });
  return row.id;
}

async function persistObservations(
  observations: RawObservation[],
): Promise<string[]> {
  const db = await getDb();
  const ids: string[] = [];
  for (const o of observations) {
    ids.push(
      await persistEvidence(db, {
        providerId: o.providerId,
        sourceName: o.sourceName,
        sourceUrl: o.sourceUrl,
        sourceType: o.sourceType,
        title: o.title,
        publisher: o.publisher ?? null,
        publicationDate: o.publicationDate,
        retrievedAt: o.retrievedAt,
        supportingText: o.supportingText,
        reliabilityScore: o.reliabilityScore,
        license: o.license ?? null,
        raw: o.raw,
        needsVerification: o.needsVerification ?? false,
      }),
    );
  }
  return ids;
}

async function brandNameFor(
  product: typeof products.$inferSelect,
): Promise<string | null> {
  if (!product.brandId) return null;
  const db = await getDb();
  const [brand] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, product.brandId))
    .limit(1);
  return brand?.name ?? null;
}

/**
 * Resolve a GTIN to a product row, creating it from the provider chain on
 * first sight. Returns null only on a CONFIRMED miss (every provider
 * answered and none knew the code); throws AppError-shaped degradation is
 * left to the caller via the degraded list when identity was found.
 */
export async function getOrCreateProduct(
  gtin14: string,
): Promise<ResolvedProduct | null> {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(products)
    .where(eq(products.gtin, gtin14))
    .limit(1);
  if (existing) {
    return {
      product: existing,
      brandName: await brandNameFor(existing),
      created: false,
      degraded: [],
    };
  }

  let identity: ProductIdentity | null = null;
  let identityObservations: RawObservation[] = [];
  const degraded: string[] = [];
  let answered = 0;

  for (const provider of registry.productLookup) {
    // TTL throttle: a recent successful fetch that found nothing is a
    // confirmed miss for this provider — don't re-ask upstream.
    if (await fetchedRecently(provider.id, gtin14)) {
      answered += 1;
      continue;
    }
    let result = await provider.lookup(gtin14);
    if (!result.ok && result.error.code === "timeout") {
      result = await provider.lookup(gtin14);
    }
    if (!result.ok) {
      if (result.error.code !== "disabled") degraded.push(provider.id);
      continue;
    }
    answered += 1;
    await recordFetch(provider.id, gtin14, true);
    if (result.data) {
      identity = result.data;
      identityObservations = result.observations;
      break;
    }
  }

  if (!identity) {
    if (answered === 0 && degraded.length > 0) {
      // Nothing answered at all — can't distinguish a miss from an outage.
      throw new UpstreamUnavailableError(degraded);
    }
    return null; // confirmed miss
  }

  const evidenceIds = await persistObservations(identityObservations);
  const brandId = identity.brand
    ? await upsertCompany(identity.brand, "brand")
    : null;
  const manufacturerId =
    identity.brandOwner && identity.brandOwner !== identity.brand
      ? await upsertCompany(identity.brandOwner, "manufacturer")
      : null;

  const [inserted] = await db
    .insert(products)
    .values({
      gtin: gtin14,
      upc: gtin14.startsWith("00") ? gtin14.slice(2) : null,
      name: identity.name ?? `Product ${gtin14}`,
      brandId,
      manufacturerId,
      category: identity.categories[0]?.toLowerCase() ?? "unknown",
      imageUrl: identity.imageUrl,
      description: null,
      ingredientsText: identity.ingredientsText,
      identityEvidenceId: evidenceIds[0],
    })
    .onConflictDoUpdate({
      target: products.gtin,
      set: { updatedAt: new Date() },
    })
    .returning();

  return {
    product: inserted,
    brandName: identity.brand,
    created: true,
    degraded,
  };
}
