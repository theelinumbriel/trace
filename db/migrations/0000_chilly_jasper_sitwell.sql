CREATE TYPE "public"."claim_status" AS ENUM('verified', 'documented', 'inferred', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('brand', 'manufacturer', 'co_packer', 'supplier', 'cooperative', 'importer', 'logistics', 'retailer', 'holding');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('material_origin', 'processing', 'manufacturing', 'packaging', 'export', 'freight', 'import', 'distribution', 'retail', 'recall');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('farm', 'cooperative', 'mill', 'processing_plant', 'factory', 'roastery', 'bottling_plant', 'port', 'warehouse', 'distribution_center', 'headquarters', 'retail_store');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('product_database', 'manufacturer_disclosure', 'sustainability_report', 'certification', 'government_record', 'recall_database', 'customs_record', 'gs1_registry', 'traceability_system', 'news_media', 'retailer_listing', 'other');--> statement-breakpoint
CREATE TYPE "public"."symbology" AS ENUM('upc_a', 'ean_13', 'ean_8', 'data_matrix', 'qr_code', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trace_kind" AS ENUM('product', 'batch');--> statement-breakpoint
CREATE TYPE "public"."trace_status" AS ENUM('pending', 'running', 'complete', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('ocean', 'air', 'rail', 'truck', 'multimodal', 'unknown');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"canonical_key" text NOT NULL,
	"parent_company_id" uuid,
	"website" text,
	"country" char(2),
	"company_type" "company_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"facility_type" "facility_type" NOT NULL,
	"city" text,
	"region" text,
	"country" char(2) NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"os_id" varchar(20),
	"unlocode" varchar(5),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"publication_date" date,
	"retrieved_at" timestamp with time zone NOT NULL,
	"supporting_text" text NOT NULL,
	"reliability_score" smallint NOT NULL,
	"license" text,
	"raw" jsonb,
	"content_hash" text NOT NULL,
	"needs_verification" boolean DEFAULT false NOT NULL,
	CONSTRAINT "evidence_reliability_ck" CHECK ("evidence"."reliability_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gtin" varchar(14) NOT NULL,
	"upc" varchar(12),
	"name" text NOT NULL,
	"brand_id" uuid,
	"manufacturer_id" uuid,
	"category" text NOT NULL,
	"image_url" text,
	"description" text,
	"ingredients_text" text,
	"identity_evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"hs_code" varchar(10)
);
--> statement-breakpoint
CREATE TABLE "product_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"origin_country" char(2),
	"origin_note" text,
	"status" "claim_status" DEFAULT 'unknown' NOT NULL,
	"confidence" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "pm_confidence_ck" CHECK ("product_materials"."confidence" BETWEEN 0 AND 100),
	CONSTRAINT "pm_unknown_zero_ck" CHECK ("product_materials"."status" <> 'unknown' OR "product_materials"."confidence" = 0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_facility_id" uuid,
	"destination_facility_id" uuid,
	"origin_port_id" uuid,
	"destination_port_id" uuid,
	"transport_mode" "transport_mode" DEFAULT 'unknown' NOT NULL,
	"departed_on" date,
	"arrived_on" date,
	"hs_code" text,
	"description" text,
	"source_evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"company_id" uuid,
	"facility_id" uuid,
	"shipment_id" uuid,
	"location_label" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"started_on" date,
	"ended_on" date,
	"status" "claim_status" NOT NULL,
	"confidence" smallint NOT NULL,
	"evidence_summary" text NOT NULL,
	"inference_basis" text,
	"rule_id" text,
	"lot_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_confidence_ck" CHECK ("supply_chain_events"."confidence" BETWEEN 0 AND 100),
	CONSTRAINT "events_inference_ck" CHECK ("supply_chain_events"."status" <> 'inferred' OR "supply_chain_events"."inference_basis" IS NOT NULL),
	CONSTRAINT "events_unknown_ck" CHECK ("supply_chain_events"."status" <> 'unknown' OR "supply_chain_events"."confidence" = 0),
	CONSTRAINT "events_band_ck" CHECK (("supply_chain_events"."status" = 'verified' AND "supply_chain_events"."confidence" BETWEEN 85 AND 100) OR
          ("supply_chain_events"."status" = 'documented' AND "supply_chain_events"."confidence" BETWEEN 70 AND 94) OR
          ("supply_chain_events"."status" = 'inferred' AND "supply_chain_events"."confidence" BETWEEN 1 AND 84) OR
          ("supply_chain_events"."status" = 'unknown' AND "supply_chain_events"."confidence" = 0))
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"event_id" uuid,
	"shipment_id" uuid,
	"product_material_id" uuid,
	"relevance" text DEFAULT 'primary' NOT NULL,
	CONSTRAINT "claim_one_target_ck" CHECK (num_nonnulls("claim_evidence"."event_id", "claim_evidence"."shipment_id", "claim_evidence"."product_material_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "trace_kind" DEFAULT 'product' NOT NULL,
	"lot_code" text,
	"serial" text,
	"expiry_date" date,
	"status" "trace_status" DEFAULT 'pending' NOT NULL,
	"pipeline" jsonb NOT NULL,
	"best_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alt_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path_score" real,
	"engine_version" text NOT NULL,
	"sources_as_of" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traces_batch_id_ck" CHECK ("traces"."kind" = 'product' OR "traces"."lot_code" IS NOT NULL OR "traces"."serial" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gtin" varchar(14) NOT NULL,
	"product_id" uuid,
	"trace_id" uuid,
	"raw_value" text NOT NULL,
	"symbology" "symbology" NOT NULL,
	"ai_data" jsonb,
	"lot_code" text,
	"locality" text,
	"approx_lat" double precision,
	"approx_lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_fetches" (
	"provider_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	CONSTRAINT "provider_fetches_provider_id_cache_key_pk" PRIMARY KEY("provider_id","cache_key")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_company_id_companies_id_fk" FOREIGN KEY ("parent_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_companies_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_companies_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_identity_evidence_id_evidence_id_fk" FOREIGN KEY ("identity_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_facility_id_facilities_id_fk" FOREIGN KEY ("origin_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_facility_id_facilities_id_fk" FOREIGN KEY ("destination_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_port_id_facilities_id_fk" FOREIGN KEY ("origin_port_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_port_id_facilities_id_fk" FOREIGN KEY ("destination_port_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_source_evidence_id_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_events" ADD CONSTRAINT "supply_chain_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_events" ADD CONSTRAINT "supply_chain_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_events" ADD CONSTRAINT "supply_chain_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_events" ADD CONSTRAINT "supply_chain_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_event_id_supply_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."supply_chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_product_material_id_product_materials_id_fk" FOREIGN KEY ("product_material_id") REFERENCES "public"."product_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_ux" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_slug_ux" ON "facilities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "facilities_company_ix" ON "facilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_url_ix" ON "evidence" USING btree ("source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_dedupe_ux" ON "evidence" USING btree ("source_url","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "products_gtin_ux" ON "products" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "products_upc_ix" ON "products" USING btree ("upc");--> statement-breakpoint
CREATE INDEX "products_brand_ix" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_slug_ux" ON "materials" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "product_materials_ux" ON "product_materials" USING btree ("product_id","material_id","role");--> statement-breakpoint
CREATE INDEX "shipments_origin_ix" ON "shipments" USING btree ("origin_facility_id");--> statement-breakpoint
CREATE INDEX "events_product_ix" ON "supply_chain_events" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_event_ux" ON "claim_evidence" USING btree ("evidence_id","event_id") WHERE "claim_evidence"."event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "traces_product_ux" ON "traces" USING btree ("product_id") WHERE "traces"."kind" = 'product';--> statement-breakpoint
CREATE UNIQUE INDEX "traces_batch_ux" ON "traces" USING btree ("product_id",coalesce("lot_code", ''),coalesce("serial", '')) WHERE "traces"."kind" = 'batch';--> statement-breakpoint
CREATE INDEX "scans_gtin_ix" ON "scans" USING btree ("gtin","created_at");