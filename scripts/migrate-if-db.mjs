// Vercel build step: run migrations when a database is attached, but let
// the build succeed before Neon is connected (runtime then shows a clear
// "connect the database" error instead of the build failing).
import { execSync } from "node:child_process";

if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  execSync("npx drizzle-kit migrate", { stdio: "inherit" });
} else {
  console.warn(
    "⚠ DATABASE_URL not set — skipping migrations. Connect the Neon integration and redeploy.",
  );
}
