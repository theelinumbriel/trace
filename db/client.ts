import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The app-wide database handle type. neon-http has no interactive
 * transactions, so application code (engine, API) is written
 * transaction-free; the seed script uses its own transactional client
 * (node-postgres or PGlite) directly.
 */
export type Db = NeonHttpDatabase<typeof schema>;

type GlobalWithDb = typeof globalThis & {
  __traceDb?: Promise<Db>;
};

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { neon } = await import("@neondatabase/serverless");
    return drizzle(neon(url), { schema });
  }

  // Dev fallback: file-backed PGlite (WASM Postgres) so `npm install &&
  // npm run dev` works with zero provisioning. Never used when DATABASE_URL
  // is set; production always runs hosted Postgres.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const path = await import("node:path");

  const client = new PGlite(path.join(process.cwd(), ".pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "db", "migrations"),
  });
  // PGlite's drizzle instance shares the query API surface we use (select /
  // insert / update / delete / query). Cast through the Neon type so call
  // sites are driver-agnostic.
  return db as unknown as Db;
}

/** Singleton across HMR reloads (PGlite dirs must not be double-opened). */
export function getDb(): Promise<Db> {
  const g = globalThis as GlobalWithDb;
  if (!g.__traceDb) g.__traceDb = createDb();
  return g.__traceDb;
}
