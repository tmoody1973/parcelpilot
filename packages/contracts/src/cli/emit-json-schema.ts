// Emits one JSON Schema file per enum into packages/contracts/schema and a copy into
// services/worker-py/app/schema (the Python Docker build context cannot see packages/).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ENUMS } from "../enums.ts";
import { RULE_SCHEMAS } from "../rules.ts";
import { POLICY_SCHEMAS } from "../policy.ts";
import { MEMO_SCHEMAS } from "../memo.ts";
import { EVIDENCE_SCHEMAS } from "../evidence.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const targets = [join(repoRoot, "packages", "contracts", "schema"), join(repoRoot, "services", "worker-py", "app", "schema")];

for (const dir of targets) mkdirSync(dir, { recursive: true });
const index: Record<string, string> = {};
for (const [name, schema] of Object.entries({ ...ENUMS, ...RULE_SCHEMAS, ...POLICY_SCHEMAS, ...MEMO_SCHEMAS, ...EVIDENCE_SCHEMAS })) {
  const json = { $id: `parcelpilot/${name}.v1`, title: name, ...z.toJSONSchema(schema, { unrepresentable: "any" }) };
  const file = `${name}.schema.json`;
  index[name] = file;
  for (const dir of targets) writeFileSync(join(dir, file), JSON.stringify(json, null, 2) + "\n");
}
for (const dir of targets) writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`emitted ${Object.keys(index).length} schemas to ${targets.length} locations`);
