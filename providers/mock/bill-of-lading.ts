import { canonicalKey } from "@/lib/canonical";
import {
  type ProviderResult,
  type RawObservation,
  type ShipmentRecord,
  type TradeDataProvider,
  reliabilityScoreFor,
} from "../types";

/**
 * MOCK — US bill-of-lading (customs manifest) records. All real sources are
 * commercial in 2026 (ImportYeti API is paid; Panjiva/ImportGenius/Datamyne
 * are enterprise; raw CBP AMS data was ruled non-FOIA-able in 2023 and is
 * sold via paid CBP subscription).
 *
 * Fixtures exist ONLY for seed products whose public customs-index pages
 * (ImportYeti/Panjiva) actually show the modeled lane — the evidence rows
 * citing those pages live in the seed data. Every record is marked
 * mock: true and the UI labels it "Illustrative — commercial data source
 * not connected".
 */
const FIXTURES: Record<string, ShipmentRecord[]> = {
  [canonicalKey("Tony's Chocolonely")]: [
    {
      shipper: "Barry Callebaut Belgium NV",
      consignee: "Tony's Chocolonely Inc.",
      originPort: { name: "Rotterdam", unlocode: "NLRTM", lat: 51.95, lng: 4.14 },
      destinationPort: {
        name: "Port of NY/NJ, Newark",
        unlocode: "USNYC",
        lat: 40.68,
        lng: -74.15,
      },
      transportMode: "ocean",
      arrivalDate: null,
      hsCode: "1806",
      mock: true,
    },
  ],
};

export const billOfLadingMock: TradeDataProvider = {
  id: "bill-of-lading-mock",

  async shipments(q): Promise<ProviderResult<ShipmentRecord[]>> {
    const keys = [q.consigneeName, q.shipperName]
      .filter((v): v is string => !!v)
      .map((v) => canonicalKey(v));
    const records = keys.flatMap((k) => FIXTURES[k] ?? []);
    if (records.length === 0) return { ok: true, data: [], observations: [] };

    const retrievedAt = new Date();
    const observations: RawObservation[] = records.map((r) => ({
      providerId: this.id,
      sourceType: "customs_record",
      sourceName: "Sample customs manifest (mock)",
      sourceUrl: "https://www.importyeti.com/supplier/tony-s-chocolonely",
      title: `Ocean shipments ${r.originPort.name} → ${r.destinationPort.name} (illustrative)`,
      publisher: "Mock adapter modeling ImportYeti/Panjiva record shape",
      publicationDate: null,
      retrievedAt,
      supportingText:
        `[Mock record — commercial data source not connected] shipper: "${r.shipper}", ` +
        `consignee: "${r.consignee}", lane: ${r.originPort.unlocode} → ${r.destinationPort.unlocode}, ` +
        `mode: ${r.transportMode}. The cited public index page shows this lane exists.`,
      reliabilityScore: reliabilityScoreFor("customs_record"),
      structured: { ...r },
      raw: r,
      mock: true,
    }));
    return { ok: true, data: records, observations };
  },
};
