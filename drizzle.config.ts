import { defineConfig } from "drizzle-kit";

// drizzle-kit migrate/generate against hosted Postgres when DATABASE_URL
// (or the unpooled migration URL) is set; otherwise against the local
// PGlite dev directory so zero-provisioning dev works.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  ...(url
    ? { dbCredentials: { url } }
    : { driver: "pglite", dbCredentials: { url: "./.pglite" } }),
});
