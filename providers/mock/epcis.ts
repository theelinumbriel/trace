import type {
  EpcisEvent,
  ProviderResult,
  TraceabilityProvider,
} from "../types";

/**
 * MOCK — EPCIS 2.0 / GS1 Digital Link resolver. No consumer product in the
 * seed set exposes a public EPCIS endpoint, and Trace does not synthesize
 * item-level provenance — so this adapter always returns an empty result.
 *
 * It exists so the BATCH TRACE code path is real end-to-end: scanning the
 * demo DataMatrix (lot TRACE-DEMO) runs this lookup, finds nothing, and the
 * UI honestly reports "No lot-specific records found; showing the
 * product-level chain." Wiring a real EPCIS repository or Digital Link
 * resolver later means implementing exactly this interface.
 */
export const epcisMock: TraceabilityProvider = {
  id: "epcis-mock",

  async itemTrace(): Promise<ProviderResult<EpcisEvent[]>> {
    return { ok: true, data: [], observations: [] };
  },
};
