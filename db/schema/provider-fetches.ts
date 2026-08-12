import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Upstream re-fetch throttle: if (provider_id, cache_key) was fetched inside
 * the provider's TTL, adapters re-read previously persisted evidence instead
 * of calling out. This is also the rate-limit compliance mechanism for
 * Open Food Facts (15 read req/min/IP) and UPCitemdb (100/day).
 */
export const providerFetches = pgTable(
  "provider_fetches",
  {
    providerId: text("provider_id").notNull(),
    cacheKey: text("cache_key").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    ok: boolean("ok").notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.cacheKey] })],
);
