/** Validate every db/seed-data/*.json against SeedFileSchema. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SeedFileSchema } from "../db/seed-schema";

const dir = path.join(process.cwd(), "db", "seed-data");
let failures = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const raw = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  const result = SeedFileSchema.safeParse(raw);
  if (result.success) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}`);
    for (const issue of result.error.issues.slice(0, 12)) {
      console.log(`   [${issue.path.join(".")}] ${issue.message}`);
    }
    if (result.error.issues.length > 12)
      console.log(`   … ${result.error.issues.length - 12} more`);
  }
}
process.exit(failures > 0 ? 1 : 0);
