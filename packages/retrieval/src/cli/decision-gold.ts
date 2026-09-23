// The gold set through shadow mode (MOO-840; 05 §9, decision 016). For every gold case, in order: lock a real run from
// the shared gold recipe (goldDecision), freeze its evidence, ask JEV in shadow and record the answer, write the brief
// (all 15 in one Message Batch), render and check the memo. Then read the comparisons back and report.
//   pnpm decision:gold [--cases G01,G02] [--max-usd 3] [--no-brief]
// Needs TYPESAFE_API_KEY (JEV) and ANTHROPIC_API_KEY (briefs). Writes docs/eval/shadow-<date>.md and the recorded JEV
// fixture the CI gate reads (packages/zoning-core/src/__fixtures__/jev-gold.json).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { DECISION_POLICY_V1, GoldCase, ZoningRule, type JevRoute, type PolicyFlags } from "@parcelpilot/contracts";
import { briefRun, goldComparisons, goldOrgId, goldSnapshot, lockGoldRun, recordJevRun } from "@parcelpilot/db";
import { RULES_ENGINE_VERSION } from "@parcelpilot/rules-engine";
import {
  BRIEFING_PROMPT_VERSION, DEFAULT_BRIEFING_EFFORT, DEFAULT_BRIEFING_MODEL, askJev, briefingBatcher, buildPreparedState, goldDecision, goldMemoInput,
  memoBrief, renderMemo, riskBucket, shadowMetrics, validateMemo, type ShadowRow,
} from "@parcelpilot/zoning-core";
import { attachEvidence, evidenceTokenBudget } from "../run-evidence.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = flag("--cases")?.split(",");
const maxUsd = Number(flag("--max-usd") ?? 3);
const withBrief = !args.includes("--no-brief");

const JURISDICTION = "milwaukee-wi";
const ANALYSIS_DATE = "2026-09-21"; // the date the gold cases were drafted (gold.test.ts)
const IN_SCOPE = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;
const root = join(import.meta.dirname, "..", "..", "..", "..");
const contracts = join(root, "packages", "contracts");
const RULES = readdirSync(join(contracts, "rules")).filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(join(contracts, "rules", f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r)));
const cases = readdirSync(join(contracts, "gold")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => GoldCase.parse(JSON.parse(readFileSync(join(contracts, "gold", f), "utf8")))).filter((c) => !only || only.includes(c.id));
const knownUses = RULES.filter((r) => r.kind === "allowed_use").flatMap((r) => Object.keys((r.params as { uses?: Record<string, string> }).uses ?? {}));

const service = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 2 });
// ponytail: one connection per case, because each brief's transaction stays open while its batch is processed
const app = postgres(process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot", { max: cases.length + 1 });

type Done = { c: GoldCase; runId: string; decision: ReturnType<typeof goldDecision> };
const done: Done[] = [];
const fixture: Record<string, { status: "ok" | "failed"; route: JevRoute | null; confidence: number | null; risk_bucket: string | null; error: string | null }> = {};

try {
  const orgId = await goldOrgId(service);
  const inOrg = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => { await tx`select set_config('app.org_id', ${orgId}, true)`; return fn(tx); }) as Promise<T>;

  for (const c of cases) {
    const decision = goldDecision(c, RULES, ANALYSIS_DATE);
    const snapshotId = await goldSnapshot(service, c, JURISDICTION);
    const runId = await inOrg((tx) => lockGoldRun(tx, { orgId, c, decision, rules: RULES, snapshotId, analysisDate: ANALYSIS_DATE, engineVersion: RULES_ENGINE_VERSION }));
    // After the lock: the same steps, in the same order, as a live run (run-service after()).
    const evidence = await inOrg((tx) => attachEvidence(tx, { runId, orgId, jurisdictionId: JURISDICTION, districts: c.parcel.base_zoning, overlays: c.parcel.overlays, analysisDate: ANALYSIS_DATE, categories: IN_SCOPE, scenario: c.scenario, tokenBudget: evidenceTokenBudget() }));
    const state = buildPreparedState({
      jurisdiction: JURISDICTION, parcel: { ...c.parcel, planned_development: [] }, scenario: c.scenario, knownUses,
      findings: decision.findings, coverage: decision.coverage, evidence: decision.evidence, policyFlags: decision.policy.policy_flags as PolicyFlags,
      bundle: evidence.status === "assembled" ? evidence.bundle : null,
    });
    const call = await askJev(state, { apiKey: process.env["TYPESAFE_API_KEY"], timeoutMs: DECISION_POLICY_V1.thresholds.jev_timeout_ms });
    await inOrg((tx) => recordJevRun(tx, { orgId, runId, decisionMode: "shadow", state, call, policy: DECISION_POLICY_V1 }));
    const ok = call.status === "ok" ? call.response.answers : null;
    fixture[c.id] = { status: call.status, route: ok?.recommended_route.choice ?? null, confidence: ok?.recommended_route.confidence ?? null, risk_bucket: ok ? riskBucket(ok.overall_risk.score, DECISION_POLICY_V1.thresholds) : null, error: call.status === "failed" ? call.error : null };
    console.log(`${c.id} locked ${decision.policy.final_status.padEnd(26)} evidence ${evidence.status.padEnd(11)} JEV ${call.status === "ok" ? `${ok!.recommended_route.choice} @${ok!.recommended_route.confidence.toFixed(2)}` : `failed: ${call.error}`} ${call.latencyMs} ms`);
    done.push({ c, runId, decision });
  }

  if (withBrief && process.env["ANTHROPIC_API_KEY"]) {
    const system = readFileSync(join(root, "prompts", `${BRIEFING_PROMPT_VERSION}.md`), "utf8");
    let reserved = 0;
    const batcher = briefingBatcher({ log: (m) => console.log(m), approve: (n, worst) => { if (reserved + worst > maxUsd) throw new Error(`spend cap: ${n} brief(s) could cost up to $${worst.toFixed(2)}, over $${maxUsd}`); reserved += worst; } });
    await Promise.all(done.map((d) => inOrg((tx) => briefRun(tx, d.runId, { orgId, model: DEFAULT_BRIEFING_MODEL, system, effort: DEFAULT_BRIEFING_EFFORT, write: (i) => batcher.write(i) }))));
  }

  // Read everything back from the database with the same query the reviewer page uses, then render each memo from its
  // latest brief (validated → the brief's sections; otherwise the template).
  const byCase = new Map((await inOrg((tx) => goldComparisons(tx, done.map((d) => d.runId)))).map((r) => [r.case_id, r]));
  const rows: (ShadowRow & { memo: string })[] = [];
  for (const d of done) {
    const [final] = await inOrg((tx) => tx<{ outcome: "validated" | "fallback"; validated_output: unknown; contract: unknown }[]>`
      select outcome, validated_output, contract from briefing_runs where feasibility_run_id = ${d.runId} order by created_at desc limit 1`);
    const brief = final?.outcome === "validated" ? memoBrief(final.validated_output, final.contract) : null;
    const input = goldMemoInput(d.c, d.decision, ANALYSIS_DATE);
    const memo = validateMemo(brief ? renderMemo(input, { brief }) : renderMemo(input, { templateNote: true }), input, brief);
    const row = byCase.get(d.c.id);
    if (!row) throw new Error(`${d.c.id}: no comparison row for run ${d.runId}`);
    rows.push({ ...row, memo: `${brief ? "brief" : "template"} ${memo.passed ? "passed" : `FAILED ${memo.problems.join(",")}`}` });
  }
  report(rows);
} finally {
  await app.end();
  await service.end();
}

function report(rows: (ShadowRow & { memo: string })[]) {
  const m = shadowMetrics(rows);
  const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(0)}%`);
  const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(4)}`);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Shadow mode over the gold set — ${date}`, "",
    `Measured by \`pnpm decision:gold\` (MOO-840, decision 016): ${rows.length} gold case(s), each locked from the shared gold recipe and then run through the live after-lock path (evidence, JEV shadow, brief via the Message Batches API, memo). Every number below is read back from \`decision_comparisons\`, \`jev_runs\` and \`briefing_runs\`. JEV never changes a status in shadow mode; its answers are logged only.`, "",
    "| Metric | Value |", "|---|---|",
    `| JEV answered | ${m.jev_ok} of ${m.cases} (${m.jev_failed} failed) |`,
    `| Route agreement, JEV vs rules-only | ${pct(m.agree_rules_only)} |`,
    `| Route agreement, JEV vs expert | ${pct(m.agree_expert)} |`,
    `| Recall on high-risk cases (expert did not say proceed; JEV did not either) | ${pct(m.high_risk_recall)} of ${m.high_risk_cases} |`,
    `| **Unsafe-permissive** (JEV says proceed where rules or expert do not; must be 0) | **${m.unsafe_permissive}** |`,
    `| p95 JEV latency | ${m.p95_jev_latency_ms ?? "n/a"} ms |`,
    `| JEV cost per case | ${usd(m.jev_cost_per_case_usd)} |`,
    `| Brief cost per case (batch price) | ${usd(m.brief_cost_per_case_usd)} |`,
    `| Briefs validated | ${m.briefs_validated} of ${rows.length} |`, "",
    "| Case | Rules-only route | JEV route (confidence) | Expert route | Agrees rules / expert | Brief | Memo |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.case_id} | ${r.rules_route} | ${r.jev_status === "ok" ? `${r.jev_route} (${r.jev_confidence?.toFixed(2)})` : `failed: ${r.jev_error ?? "?"}`} | ${r.expert_route} | ${r.jev_status === "ok" ? `${r.jev_route === r.rules_route ? "yes" : "no"} / ${r.jev_route === r.expert_route ? "yes" : "no"}` : "—"} | ${r.brief_outcome ?? "none"} | ${r.memo} |`),
    "",
  ];
  writeFileSync(join(root, "docs", "eval", `shadow-${date}.md`), lines.join("\n"));
  writeFileSync(join(root, "packages", "zoning-core", "src", "__fixtures__", "jev-gold.json"), JSON.stringify({ recorded: date, cases: fixture }, null, 1) + "\n");
  console.log(lines.slice(4, 15).join("\n"));
  console.log(`\nreport: docs/eval/shadow-${date}.md  fixture: packages/zoning-core/src/__fixtures__/jev-gold.json`);
}
