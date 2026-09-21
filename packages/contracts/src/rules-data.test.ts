import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ZoningRule } from "./rules.ts";

const dir = join(import.meta.dirname, "..", "rules");
test("every rule data file validates as ZoningRule[] with page-level citations", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const rules = (JSON.parse(readFileSync(join(dir, f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r));
    assert.ok(rules.length > 0, f);
    for (const r of rules) {
      assert.ok(r.citations.every((c) => c.page > 0 && /^[0-9a-f]{64}$/.test(c.document_id)), `${r.id} cites a sha256 and a page`);
      assert.ok(r.conditions.every((c) => c.evaluable || "status" in c.effect), `${r.id}: a non-evaluable condition must force verify`);
    }
    assert.equal(new Set(rules.map((r) => `${r.family_id}:${r.version}`)).size, rules.length, "family+version unique");
  }
});
