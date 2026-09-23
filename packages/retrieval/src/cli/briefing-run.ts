// Writes one brief for a stored, locked run and records it in briefing_runs (MOO-837). Reads and writes as app_role
// scoped to the run's org, so RLS applies exactly as it will in the app. The brief is validated (05 §7), repaired at
// most once, and recorded as `validated` only if every validator passed it.
// Usage: pnpm briefing:run --run <feasibility run id> [--model claude-opus-5-5] [--effort medium]   (defaults: decision 014)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { briefRun } from "@parcelpilot/db";
import { BRIEFING_PROMPT_VERSION, DEFAULT_BRIEFING_EFFORT, DEFAULT_BRIEFING_MODEL } from "@parcelpilot/zoning-core";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const runId = flag("--run");
if (!runId) { console.error("--run is required"); process.exit(2); }
const model = flag("--model") ?? process.env["BRIEFING_MODEL"] ?? DEFAULT_BRIEFING_MODEL;
const effort = (flag("--effort") as "low" | "medium" | "high" | undefined) ?? DEFAULT_BRIEFING_EFFORT;
const root = join(import.meta.dirname, "..", "..", "..", "..");
const service = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
const app = postgres(process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot", { max: 1 });
try {
  const [owner] = await service<{ org_id: string }[]>`select org_id from feasibility_runs where id = ${runId}`; // only to learn which org to scope to
  if (!owner) throw new Error(`no run ${runId}`);
  await app.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${owner.org_id}, true)`;
    const system = readFileSync(join(root, "prompts", `${BRIEFING_PROMPT_VERSION}.md`), "utf8");
    const r = await briefRun(tx, runId, { orgId: owner.org_id, model, system, effort });
    const rows = await tx<{ id: string; outcome: string; model_version: string | null; latency_ms: number; input_tokens: number | null; output_tokens: number | null; cost: number | null; error: string | null }[]>`
      select id, outcome, model_version, latency_ms, input_tokens, output_tokens, cost_estimate_usd::float8 as cost, error from briefing_runs where id = any(${r.briefingRunIds}::uuid[]) order by created_at`;
    const checks = await tx<{ briefing_run_id: string; validator: string; result: string; effect: string; removed: number }[]>`
      select briefing_run_id, validator, result, effect, cardinality(removed_sentence_ids) as removed from validation_runs where briefing_run_id = any(${r.briefingRunIds}::uuid[]) and result <> 'pass' order by created_at`;
    console.log(JSON.stringify({ outcome: r.outcome, attempts: r.attempts, briefing_runs: rows, non_passing_checks: checks }, null, 2));
  });
} finally {
  await Promise.all([service.end(), app.end()]);
}
