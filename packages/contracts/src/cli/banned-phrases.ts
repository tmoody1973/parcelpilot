// Usage: node packages/contracts/src/cli/banned-phrases.ts <dir-or-file>...
// Scans UI source and memo templates for verdict words the product must never use. Exit 1 on any hit.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { findBannedPhrases } from "../banned-phrases.ts";

const EXTS = new Set([".tsx", ".ts", ".md", ".txt", ".hbs", ".mdx", ".json"]);

function* walk(path: string): Generator<string> {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isFile()) { if (EXTS.has(extname(path))) yield path; return; }
  for (const entry of readdirSync(path)) {
    // __fixtures__ holds recorded test data (quoted ordinance text, saved model output); the tests scan it themselves.
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === "__fixtures__") continue;
    yield* walk(join(path, entry));
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) { console.error("no paths given"); process.exit(2); }
let total = 0;
for (const root of roots) for (const file of walk(root)) {
  for (const hit of findBannedPhrases(readFileSync(file, "utf8"))) {
    total++;
    console.error(`${file}:${hit.line}:${hit.column}  banned phrase "${hit.phrase}"  →  ${hit.text}`);
  }
}
if (total > 0) { console.error(`\n✖ ${total} banned phrase${total === 1 ? "" : "s"} (product copy must not state a zoning verdict)`); process.exit(1); }
console.log(`✓ no banned phrases in ${roots.join(", ")}`);
