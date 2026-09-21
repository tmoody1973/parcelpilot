import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDecisionMode } from "./decision-mode.ts";

test("defaults to rules_only when nothing is configured", async () => {
  assert.deepEqual(await resolveDecisionMode({ env: {} }), { mode: "rules_only", source: "default" });
});
test("invalid env value falls back to rules_only", async () => {
  assert.deepEqual(await resolveDecisionMode({ env: { DECISION_MODE: "yolo" } }), { mode: "rules_only", source: "default" });
});
test("env value is honored", async () => {
  assert.deepEqual(await resolveDecisionMode({ env: { DECISION_MODE: "shadow" } }), { mode: "shadow", source: "env" });
});
test("DB override beats env; invalid override is ignored", async () => {
  assert.deepEqual(await resolveDecisionMode({ env: { DECISION_MODE: "shadow" }, orgId: "org1", lookupOverride: async () => "rules_only" }), { mode: "rules_only", source: "db_override" });
  assert.deepEqual(await resolveDecisionMode({ env: { DECISION_MODE: "shadow" }, orgId: "org1", lookupOverride: async () => "nonsense" }), { mode: "shadow", source: "env" });
});
