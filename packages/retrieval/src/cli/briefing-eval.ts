// Briefing model evaluation (MOO-837; 05 §6, §9). For every gold case: the engine and policy produce the signed-off
// answer (the recipe gold.test.ts proves), offline retrieval freezes the evidence, and one contract is built and hashed.
// Each model then writes a brief from that same contract, scored by quick pre-validator checks. These checks are not
// the MOO-838 validators; they are enough to compare models before the validators exist.
// Usage: pnpm briefing:eval [--models claude-fable-5-1,claude-sonnet-5,openai/gpt-6-luna,google/gemini-3.8-flash] [--cases G01,G02] [--effort high] [--max-usd 15] [--prompt briefing.v2] [--tag name] [--allow-retention openai/gpt-6-luna] | --rescore a.jsonl,b.jsonl --tag combined
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { BANNED_PHRASES, DECISION_POLICY_V1, GoldCase, RuleCategory, ZoningRule, findBannedPhrases, type BriefingContract, type BriefingOutput, type ParcelFacts, type PolicyInput } from "@parcelpilot/contracts";
import { evaluate } from "@parcelpilot/rules-engine";
import { BRIEFING_MODELS, BRIEFING_PROMPT_VERSION, OPENROUTER_PRICES, writeBriefOpenRouter, briefingContractHash, buildBriefingContract, checkCitations, finalStatus, writeBrief, type BriefingCall } from "@parcelpilot/zoning-core";
import { retrieve } from "../retrieve.ts";
import { assembleBundle } from "../bundle.ts";
import { evidenceTokenBudget, subquestionsFor } from "../run-evidence.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const models = (flag("--models") ?? BRIEFING_MODELS.join(",")).split(",");
const only = flag("--cases")?.split(",");
const effort = flag("--effort") as "low" | "medium" | "high" | undefined;
const maxUsd = Number(flag("--max-usd") ?? 15);
const allowRetention = (flag("--allow-retention") ?? "").split(",").filter(Boolean); // OpenRouter models run without zero data retention
const rescore = flag("--rescore")?.split(","); // re-check saved briefs against rebuilt contracts; no model calls
const tag = flag("--tag"); // a second run on the same day writes its own files instead of replacing the first
const suffix = tag ? `${new Date().toISOString().slice(0, 10)}-${tag}` : new Date().toISOString().slice(0, 10);
const root = join(import.meta.dirname, "..", "..", "..", "..");
const date = new Date().toISOString().slice(0, 10);
const ANALYSIS_DATE = "2026-09-21"; // the date the gold cases were drafted (gold.test.ts)
const promptVersion = flag("--prompt") ?? BRIEFING_PROMPT_VERSION; // e.g. briefing.v2; recorded in the report
const system = readFileSync(join(root, "prompts", `${promptVersion}.md`), "utf8");
const RULES = readdirSync(join(root, "packages", "contracts", "rules")).filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(join(root, "packages", "contracts", "rules", f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r)));
const cases = readdirSync(join(root, "packages", "contracts", "gold")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => GoldCase.parse(JSON.parse(readFileSync(join(root, "packages", "contracts", "gold", f), "utf8")))).filter((c) => !only || only.includes(c.id));
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });

// The contract for one gold case: the same engine → citation gate → policy chain a live run uses, plus fresh evidence.
async function contractFor(c: GoldCase): Promise<BriefingContract> {
  const parcel: ParcelFacts = { lot_area_sqft: c.parcel.lot_area_sqft, lot_area_suspect: c.parcel.lot_area_suspect, base_zoning: c.parcel.base_zoning, planned_development: [], overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, attributes: {} };
  const policyParcel: PolicyInput["parcel"] = { overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, planned_development: [], floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, stacked_condo_candidates: c.parcel.stacked_condo_candidates };
  const blocked = c.expected.pre_run_block;
  const out = blocked ? { findings: [], coverage: { checked: [], manual_review: [], unknown: [...RuleCategory.options] } } : evaluate({ parcel, scenario: c.scenario, rules: RULES, categories_in_scope: [...RuleCategory.options], analysis_date: ANALYSIS_DATE });
  const shas = [...new Set(RULES.flatMap((r) => [...r.citations, ...r.conditions.map((x) => x.citation)]).map((x) => x.document_id))];
  const sources = Object.fromEntries(shas.map((sha) => [sha, { status: c.expected.evidence.active_code_version ? "active" as const : "superseded" as const, effective_start: null, effective_end: null }]));
  const evidence = checkCitations({ findings: out.findings, sources, rules: Object.fromEntries(RULES.map((r) => [r.id, { status: r.status }])), analysis_date: ANALYSIS_DATE });
  const policy = finalStatus({ findings: out.findings, coverage: out.coverage, evidence, parcel: policyParcel, ...(blocked ? { pre_run_block: blocked } : {}), decision_mode: "rules_only" });
  if (policy.final_status !== c.expected.final_status) throw new Error(`${c.id}: policy gave ${policy.final_status}, gold expects ${c.expected.final_status}`);
  const runIds: string[] = [];
  for (const [category, q] of subquestionsFor({ districts: c.parcel.base_zoning, categories: RuleCategory.options, scenario: c.scenario })) {
    runIds.push((await retrieve(sql, { jurisdictionId: "milwaukee-wi", subquestion: q, category, districts: c.parcel.base_zoning, overlays: c.parcel.overlays, analysisDate: date }))!.run_id!);
  }
  const bundle = await assembleBundle(sql, { retrievalRunIds: runIds, tokenBudget: evidenceTokenBudget(), analysisDate: date });
  return buildBriefingContract({
    run: { id: `gold-${c.id}`, locked_at: "gold-case", final_status: policy.final_status, route: policy.route, risk: policy.risk, reasons: policy.reasons, triggers: policy.triggers, coverage: out.coverage },
    parcel: { taxkey: c.parcel.taxkey ?? "", address: c.parcel.address ?? null, lot_area_sqft: c.parcel.lot_area_sqft, base_zoning: c.parcel.base_zoning, retrieved_at: c.parcel.retrieved_at ?? null },
    scenario: c.scenario, findings: out.findings.map((f) => ({ finding: f, calculation_id: f.calculation_ids[0] ?? null })), bundle, jev: null,
  }, DECISION_POLICY_V1);
}

// Pre-validator checks on one brief (05 §9 briefing metrics, approximated).
function check(contract: BriefingContract, hash: string, o: BriefingOutput) {
  const sentences = [...o.executive_summary, ...o.status_explanation, ...o.verified_findings.flatMap((v) => v.sentences), ...o.open_questions, ...o.suggested_actions.map((a) => a.rationale), ...o.questions_for_experts.map((q) => q.question)];
  const ids = new Set(contract.evidence_bundle.map((e) => e.source_id));
  const cited = sentences.flatMap((s) => s.source_ids);
  const claims = sentences.filter((s) => s.kind === "fact" || s.kind === "code" || s.kind === "finding");
  const mustCover = contract.verified_findings.filter((f) => f.status === "fail" || f.status === "verify").map((f) => f.finding_id);
  const covered = new Set(o.verified_findings.map((v) => v.finding_id));
  // Numbers compare without thousands separators: the contract may hold 29934 where a sentence writes 29,934.
  const bare = (n: string) => n.replace(/,/g, "").replace(/\.$/, "");
  const contractNumbers = new Set((JSON.stringify(contract).match(/\d[\d,.]*\d|\d/g) ?? []).map(bare));
  const invented = sentences.flatMap((s) => s.text.match(/\d[\d,.]*\d|\d/g) ?? []).map(bare).filter((n) => !contractNumbers.has(n));
  const banned = findBannedPhrases([...sentences.map((s) => s.text), o.disclaimer].join("\n"));
  const abstains = contract.final_decision.status !== "insufficient_evidence"
    || (o.suggested_actions.every((a) => a.action_id === "collect_missing_information" || a.action_id === "contact_city") && !sentences.some((s) => s.kind === "finding"));
  const r = {
    status_echo: o.status_echo === contract.final_decision.status,
    hash_echo: o.contract_hash === hash,
    disclaimer: o.disclaimer === contract.required_disclaimer,
    citation_precision: cited.length ? cited.filter((id) => ids.has(id)).length / cited.length : 1,
    uncited_claims: claims.filter((s) => s.source_ids.length === 0).length,
    claims: claims.length,
    finding_coverage: mustCover.length ? mustCover.filter((id) => covered.has(id)).length / mustCover.length : 1,
    disallowed_actions: o.suggested_actions.filter((a) => !contract.allowed_next_actions.includes(a.action_id as never)).length,
    banned_hits: banned.length,
    invented_numbers: invented.length,
    abstention: abstains,
    sentences: sentences.length,
  };
  return { ...r, pass: r.status_echo && r.hash_echo && r.disclaimer && r.citation_precision === 1 && r.uncited_claims === 0 && r.finding_coverage === 1 && r.disallowed_actions === 0 && r.banned_hits === 0 && r.invented_numbers === 0 && r.abstention };
}

type Row = { model: string; case: string; call: BriefingCall; checks: ReturnType<typeof check> | null; hash: string };
const rows: Row[] = [];
let spent = 0;
type Saved = { case: string; model: string; contract_hash: string; status: "ok" | "failed"; model_version: string | null; error: string | null; usage: { input_tokens: number; output_tokens: number } | null; latency_ms: number; cost_usd: number | null; output: BriefingOutput | null };
if (rescore) {
  // Every saved brief is re-checked against its case's contract, rebuilt exactly as the run built it. A hash mismatch
  // means the brief was written from different input, so it is counted and left unscored rather than scored.
  // A later file's brief for the same model and case replaces an earlier one (a retry after a provider outage).
  const saved = [...new Map(rescore.flatMap((p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Saved)).map((x) => [`${x.model}|${x.case}`, x])).values()];
  models.splice(0, models.length, ...[...new Set(saved.map((x) => x.model))]);
  const contracts = new Map<string, { contract: BriefingContract; hash: string }>();
  try {
    for (const c of cases) { const contract = await contractFor(c); contracts.set(c.id, { contract, hash: briefingContractHash(contract) }); }
  } finally { await sql.end(); }
  let mismatched = 0;
  for (const x of saved) {
    const k = contracts.get(x.case);
    if (!k) continue;
    if (k.hash !== x.contract_hash) mismatched++;
    const call: BriefingCall = x.status === "ok" && x.output
      ? { status: "ok", output: x.output, raw: "", model: x.model_version ?? x.model, usage: x.usage!, latencyMs: x.latency_ms, costUsd: x.cost_usd ?? 0 }
      : { status: "failed", error: x.error ?? "unknown", raw: null, model: x.model_version, usage: x.usage, latencyMs: x.latency_ms, costUsd: x.cost_usd };
    const checks = call.status === "ok" && k.hash === x.contract_hash ? check(k.contract, k.hash, call.output) : null;
    rows.push({ model: x.model, case: x.case, call, checks, hash: x.contract_hash });
  }
  console.log(`rescored ${rows.length} briefs from ${rescore.length} files; contract hash mismatches: ${mismatched}`);
  write();
  process.exit(0);
}
try {
  for (const c of cases) {
    const contract = await contractFor(c);
    const hash = briefingContractHash(contract);
    for (const model of models) {
      if (spent >= maxUsd) throw new Error(`spend cap reached: $${spent.toFixed(2)} of $${maxUsd}; stopping before ${c.id} on ${model}`);
      const call = OPENROUTER_PRICES[model]
        ? await writeBriefOpenRouter({ contract, contractHash: hash, system, model, apiKey: process.env["OPENROUTER_API_KEY"], allowRetention: allowRetention.includes(model) })
        : await writeBrief({ contract, contractHash: hash, system, model, ...(effort ? { effort } : {}) });
      spent += call.costUsd ?? 0;
      const checks = call.status === "ok" ? check(contract, hash, call.output) : null;
      rows.push({ model, case: c.id, call, checks, hash });
      console.log(`${c.id} ${model.padEnd(18)} ${call.status.padEnd(6)} ${checks ? (checks.pass ? "PASS" : "fail") : "----"} ${String(call.latencyMs).padStart(6)} ms  in ${call.usage?.input_tokens ?? "-"} out ${call.usage?.output_tokens ?? "-"}  $${(call.costUsd ?? 0).toFixed(4)}${call.status === "failed" ? `  ${call.error.slice(0, 120)}` : ""}${checks && !checks.pass ? `  ${JSON.stringify(checks)}` : ""}`);
    }
  }
} finally {
  await sql.end();
  write();
}

function write() {
  if (!rows.length) return;
  const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0; };
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  const summary = models.map((m) => {
    const r = rows.filter((x) => x.model === m);
    const ok = r.filter((x) => x.checks);
    const ch = ok.map((x) => x.checks!);
    const claims = ch.reduce((a, c) => a + c.claims, 0);
    return `| ${m} | ${r.length} | ${pct(ok.length / (r.length || 1))} | ${pct(ch.filter((c) => c.pass).length / (r.length || 1))} | ${pct(ch.filter((c) => c.status_echo).length / (r.length || 1))} | ${mean(ch.map((c) => c.citation_precision)).toFixed(3)} | ${claims ? pct(ch.reduce((a, c) => a + c.uncited_claims, 0) / claims) : "–"} | ${mean(ch.map((c) => c.finding_coverage)).toFixed(3)} | ${ch.reduce((a, c) => a + c.invented_numbers, 0)} | ${ch.reduce((a, c) => a + c.banned_hits, 0)} | ${ch.reduce((a, c) => a + c.disallowed_actions, 0)} | ${pct(ch.filter((c) => c.abstention).length / (ch.length || 1))} | ${(p95(r.map((x) => x.call.latencyMs)) / 1000).toFixed(1)} s | $${mean(r.map((x) => x.call.costUsd ?? 0)).toFixed(4)} | $${r.reduce((a, x) => a + (x.call.costUsd ?? 0), 0).toFixed(2)} |`;
  });
  const lines = [
    `# Briefing model evaluation — ${date}`, "",
    `Prompt \`${promptVersion}\`, schema \`briefing_output.v1\`, effort ${effort ?? "model default"}, ${cases.length} gold case(s), one contract per case shared by every model. Measured by \`pnpm briefing:eval\`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.`, "",
    "| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...summary, "",
    "Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):", "",
    `| Case | ${models.join(" | ")} |`, `|---|${models.map(() => "---").join("|")}|`,
    ...cases.filter((c) => rows.some((r) => r.case === c.id)).map((c) => `| ${c.id} | ${models.map((m) => { const r = rows.find((x) => x.case === c.id && x.model === m); return !r ? "" : !r.checks ? `– ${r.call.status === "failed" ? r.call.error.slice(0, 40) : ""}` : r.checks.pass ? "✓" : `✗ ${Object.entries(r.checks).filter(([k, v]) => k !== "pass" && (v === false || (typeof v === "number" && ((k.endsWith("precision") || k.endsWith("coverage")) ? v < 1 : ["uncited_claims", "disallowed_actions", "banned_hits", "invented_numbers"].includes(k) && v > 0)))).map(([k]) => k).join(", ")}`; }).join(" | ")} |`),
    "", `Banned phrases checked: ${BANNED_PHRASES.join(", ")}. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10, claude-opus-5-5 $4 / $20 (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except ${allowRetention.length ? allowRetention.join(", ") : "none"}) openai/gpt-6-luna $0.10 / $0.50, google/gemini-3.8-flash $0.75 / $3.75, openai/gpt-6-sol $2 / $10, moonshotai/kimi-k3 $3 / $15, deepseek/deepseek-v4.1-flash $0.10 / $0.50 (list prices; open-weight hosts vary). Every brief, its contract hash and its checks are in \`briefings-${date}.jsonl\`.`, "",
  ];
  mkdirSync(join(root, "docs", "eval"), { recursive: true });
  writeFileSync(join(root, "docs", "eval", `briefing-model-${suffix}.md`), lines.join("\n"));
  writeFileSync(join(root, "docs", "eval", `briefings-${suffix}.jsonl`), rows.map((r) => JSON.stringify({ case: r.case, model: r.model, contract_hash: r.hash, status: r.call.status, model_version: r.call.model, error: r.call.status === "failed" ? r.call.error : null, usage: r.call.usage, latency_ms: r.call.latencyMs, cost_usd: r.call.costUsd, checks: r.checks, output: r.call.status === "ok" ? r.call.output : null })).join("\n") + "\n");
  console.log(`\nreport: docs/eval/briefing-model-${suffix}.md  spent $${spent.toFixed(2)}`);
}
