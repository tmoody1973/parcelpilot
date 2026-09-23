// Writes one brief for a stored, locked run and records it in briefing_runs (MOO-837). Reads and writes as app_role
// scoped to the run's org, so RLS applies exactly as it will in the app. Until MOO-838 the row is recorded as
// `fallback`: the brief is kept for review, never shown.
// Usage: pnpm briefing:run --run <feasibility run id> [--model claude-opus-5-5] [--effort medium]   (defaults: decision 014)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { DECISION_POLICY_V1 } from "@parcelpilot/contracts";
import { loadBriefingRecord, recordBriefingRun } from "@parcelpilot/db";
import { BRIEFING_PROMPT_VERSION, DEFAULT_BRIEFING_EFFORT, DEFAULT_BRIEFING_MODEL, briefingContractHash, buildBriefingContract, writeBrief } from "@parcelpilot/zoning-core";

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
    const record = await loadBriefingRecord(tx, runId);
    if (!record) throw new Error(`run ${runId} is not visible to its own org`);
    const contract = buildBriefingContract(record, DECISION_POLICY_V1);
    const hash = briefingContractHash(contract);
    const call = await writeBrief({ contract, contractHash: hash, system: readFileSync(join(root, "prompts", `${BRIEFING_PROMPT_VERSION}.md`), "utf8"), model, ...(effort ? { effort } : {}) });
    const id = await recordBriefingRun(tx, { orgId: owner.org_id, runId, contract, contractHash: hash, call, requestedModel: model });
    console.log(JSON.stringify({ briefing_run_id: id, model: call.model, status: call.status, contract_hash: hash, status_echo: call.status === "ok" ? call.output.status_echo : null, final_status: contract.final_decision.status, latency_ms: call.latencyMs, usage: call.usage, cost_usd: call.costUsd, error: call.status === "failed" ? call.error : null }));
  });
} finally {
  await Promise.all([service.end(), app.end()]);
}
