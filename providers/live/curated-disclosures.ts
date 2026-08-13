import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, facilities } from "@/db/schema";
import { canonicalKey } from "@/lib/canonical";
import type {
  FacilityProvider,
  FacilityRecord,
  ProviderResult,
} from "../types";

/**
 * Facilities sourced from already-persisted corporate disclosures (seed
 * evidence: Oatly investor PRs, Tony's/Barry Callebaut announcements,
 * Patagonia supplier list via Open Supply Hub, …). Reads the DB; the
 * evidence rows behind these facilities were persisted by the seed loader,
 * so no new observations are minted here.
 */
export const curatedDisclosures: FacilityProvider = {
  id: "curated-disclosures",

  async facilities(q): Promise<ProviderResult<FacilityRecord[]>> {
    try {
      const db = await getDb();
      const target = canonicalKey(q.companyName);
      const rows = await db
        .select({
          name: facilities.name,
          facilityType: facilities.facilityType,
          city: facilities.city,
          region: facilities.region,
          country: facilities.country,
          lat: facilities.lat,
          lng: facilities.lng,
          osId: facilities.osId,
          companyCanonical: companies.canonicalKey,
        })
        .from(facilities)
        .innerJoin(companies, eq(facilities.companyId, companies.id));
      const matches = rows.filter((r) => r.companyCanonical === target);
      return {
        ok: true,
        data: matches.map((m) => ({
          name: m.name,
          facilityType: m.facilityType,
          city: m.city ?? undefined,
          region: m.region ?? undefined,
          country: m.country,
          lat: m.lat ?? undefined,
          lng: m.lng ?? undefined,
          osId: m.osId ?? undefined,
        })),
        observations: [],
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "parse_error",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};
