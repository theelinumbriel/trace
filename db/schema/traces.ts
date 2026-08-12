import {
  pgTable,
  uuid,
  text,
  date,
  real,
  jsonb,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { traceKindEnum, traceStatusEnum } from "./enums";
import { products } from "./products";
import type { TracePipeline, RankedPath } from "../json-types";

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: traceKindEnum("kind").notNull().default("product"),
    lotCode: text("lot_code"), // AI(10)
    serial: text("serial"), // AI(21)
    /** AI(17) — observed from the scanned code itself, not a claim. */
    expiryDate: date("expiry_date"),
    status: traceStatusEnum("status").notNull().default("pending"),
    /** Live checklist steps — TracePipelineSchema-validated on write/read. */
    pipeline: jsonb("pipeline").$type<TracePipeline>().notNull(),
    /** Ordered supply_chain_events.id[] of the best-supported path. */
    bestPath: jsonb("best_path")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    altPaths: jsonb("alt_paths")
      .$type<RankedPath[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 0–100, best-path aggregate (min of non-unknown event confidences). */
    pathScore: real("path_score"),
    /** "seed-1" | "recon-0.1.0" — provenance + determinism marker. */
    engineVersion: text("engine_version").notNull(),
    /** Freshness of the evidence this trace was computed from. */
    sourcesAsOf: timestamp("sources_as_of", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    /** Heartbeat for stale-running detection (crashed pipelines). */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "traces_batch_id_ck",
      sql`${t.kind} = 'product' OR ${t.lotCode} IS NOT NULL OR ${t.serial} IS NOT NULL`,
    ),
    // One canonical product-level trace per product.
    uniqueIndex("traces_product_ux")
      .on(t.productId)
      .where(sql`${t.kind} = 'product'`),
    // One batch trace per (product, lot, serial); coalesce so lot-only keys dedupe.
    uniqueIndex("traces_batch_ux")
      .on(
        t.productId,
        sql`coalesce(${t.lotCode}, '')`,
        sql`coalesce(${t.serial}, '')`,
      )
      .where(sql`${t.kind} = 'batch'`),
  ],
);
