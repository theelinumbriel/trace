import { pgEnum } from "drizzle-orm/pg-core";

/**
 * The four spec statuses. "Observed" (the scan node) is NOT an enum value:
 * the scan step is rendered from the `scans` table and labeled Observed in
 * the UI — it is a direct first-party observation, not a claim needing
 * evidence.
 */
export const claimStatusEnum = pgEnum("claim_status", [
  "verified", // direct structured traceability OR ≥2 independent primary sources
  "documented", // a primary document from the responsible party
  "inferred", // derived from sourced evidence via a stated basis
  "unknown", // first-class: no evidence; rendered with an uncertainty statement
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "product_database", // Open Food Facts, UPCitemdb, FDC branded foods
  "manufacturer_disclosure", // brand's own site/pages/press releases
  "sustainability_report", // annual/CSR/transparency reports
  "certification", // Fairtrade, B Corp, organic certifier DBs
  "government_record", // FDA/USDA non-recall records
  "recall_database", // openFDA enforcement
  "customs_record", // BoL indexes (ImportYeti/Panjiva public pages; mocked API)
  "gs1_registry", // Verified by GS1 / GS1 US Company Database (manual, mocked API)
  "traceability_system", // EPCIS / GS1 Digital Link resolvers
  "news_media",
  "retailer_listing",
  "other",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "material_origin",
  "processing",
  "manufacturing",
  "packaging",
  "export",
  "freight",
  "import",
  "distribution",
  "retail",
  "recall",
]);

export const transportModeEnum = pgEnum("transport_mode", [
  "ocean",
  "air",
  "rail",
  "truck",
  "multimodal",
  "unknown",
]);

export const facilityTypeEnum = pgEnum("facility_type", [
  "farm",
  "cooperative",
  "mill",
  "processing_plant",
  "factory",
  "roastery",
  "bottling_plant",
  "port",
  "warehouse",
  "distribution_center",
  "headquarters",
  "retail_store",
]);

export const companyTypeEnum = pgEnum("company_type", [
  "brand",
  "manufacturer",
  "co_packer",
  "supplier",
  "cooperative",
  "importer",
  "logistics",
  "retailer",
  "holding",
]);

export const traceKindEnum = pgEnum("trace_kind", ["product", "batch"]);

export const traceStatusEnum = pgEnum("trace_status", [
  "pending",
  "running",
  "complete",
  "partial", // completed, but one or more stages errored or sources were unreachable
  "failed",
]);

export const symbologyEnum = pgEnum("symbology", [
  "upc_a",
  "ean_13",
  "ean_8",
  "data_matrix",
  "qr_code",
  "manual",
]);
