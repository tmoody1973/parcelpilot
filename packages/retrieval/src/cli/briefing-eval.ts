// Briefing model evaluation (MOO-837; 05 §6, §9). For every gold case: the engine and policy produce the signed-off
// answer (the recipe gold.test.ts proves), offline retrieval freezes the evidence, and one contract is built and hashed.
// Each model then writes a brief from that same contract through the production path: the contract's own output
// schema, the eleven 05 §7 validators and at most one repair (MOO-838).
// Usage: pnpm briefing:eval [--models claude-fable-5-1,claude-sonnet-5,openai/gpt-6-luna,google/gemini-3.8-flash] [--cases G01,G02] [--effort high] [--max-usd 15] [--prompt briefing.v2] [--runs 3] [--tag name] [--allow-retention openai/gpt-6-luna] [--batch] | --rescore a.jsonl,b.jsonl --tag combined
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { BANNED_PHRASES, DECISION_POLICY_V1, GoldCase, RuleCategory, ZoningRule, briefingOutputSchemaFor, type BriefingContract, type BriefingOutput } from "@parcelpilot/contracts";
import {
  BRIEFING_MODELS, BRIEFING_PRICES, BRIEFING_PROMPT_VERSION, OPENROUTER_PRICES, briefingContractHash, buildBriefingContract, goldDecision,
  briefingBatcher, validateBrief, writeBrief, writeBriefOpenRouter, writeValidatedBrief, type BriefingCall, type ValidatedBrief,
} from "@parcelpilot/zoning-core";
import { retrieve } from "../retrieve.ts";
import { assembleBundle } from "../bundle.ts";
import { evidenceTokenBudget, subquestionsFor } from "../run-evidence.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const models = (flag("--models") ?? BRIEFING_MODELS.join(",")).split(",");
const only = flag("--cases")?.split(",");
const effort = flag("--effort") as "low" | "medium" | "high" | undefined;
const maxUsd = Number(flag("--max-usd") ?? 15);
const runs = Math.max(1, Number(flag("--runs") ?? 1)); // repeat each case to measure consistency
const allowRetention = (flag("--allow-retention") ?? "").split(",").filter(Boolean); // OpenRouter models run without zero data retention
const rescore = flag("--rescore")?.split(","); // re-validate saved briefs against their contracts; no model calls
const batch = args.includes("--batch"); // Message Batches API: half price, answers in minutes to hours (Claude models only)
const tag = flag("--tag"); // a second run on the same day writes its own files instead of replacing the first
const suffix = tag ? `${new Date().toISOString().slice(0, 10)}-${tag}` : new Date().toISOString().slice(0, 10);
const root = join(import.meta.dirname, "..", "..", "..", "..");
const date = new Date().toISOString().slice(0, 10);
// Each distinct contract is stored once, by hash, outside git (docs/eval/.contracts is ignored): ~70 KB each.
const contractPath = (hash: string) => join(root, "docs", "eval", ".contracts", `${hash}.json`);
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
  const { findings, coverage, policy } = goldDecision(c, RULES, ANALYSIS_DATE);
  const runIds: string[] = [];
  for (const [category, q] of subquestionsFor({ districts: c.parcel.base_zoning, categories: RuleCategory.options, scenario: c.scenario })) {
    runIds.push((await retrieve(sql, { jurisdictionId: "milwaukee-wi", subquestion: q, category, districts: c.parcel.base_zoning, overlays: c.parcel.overlays, analysisDate: date }))!.run_id!);
  }
  const bundle = await assembleBundle(sql, { retrievalRunIds: runIds, tokenBudget: evidenceTokenBudget(), analysisDate: date });
  return buildBriefingContract({
    run: { id: `gold-${c.id}`, locked_at: "gold-case", final_status: policy.final_status, route: policy.route, risk: policy.risk, reasons: policy.reasons, triggers: policy.triggers, coverage },
    parcel: { taxkey: c.parcel.taxkey ?? "", address: c.parcel.address ?? null, lot_area_sqft: c.parcel.lot_area_sqft, base_zoning: c.parcel.base_zoning, retrieved_at: c.parcel.retrieved_at ?? null },
    scenario: c.scenario, findings: findings.map((f) => ({ finding: f, calculation_id: f.calculation_ids[0] ?? null })), bundle, jev: null,
  }, DECISION_POLICY_V1);
}

// Retrieval embeds each question over the network; one dropped connection must not end a 15-case run.
async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      console.log(`  ${what}: attempt ${i} failed (${e instanceof Error ? e.message : String(e)}); retrying in ${2 * i} s`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// Every brief goes through what production runs (MOO-838): the contract's own output schema, the eleven validators,
// and at most one repair. `--runs N` repeats each case to measure how often a case flips between validated and not.
type Row = { model: string; case: string; run: number; hash: string; contract?: BriefingContract; result: ValidatedBrief };
const rows: Row[] = [];
let spent = 0;
const costOf = (r: ValidatedBrief) => r.attempts.reduce((a, x) => a + (x.call.costUsd ?? 0), 0);
const latencyOf = (r: ValidatedBrief) => r.attempts.reduce((a, x) => a + x.call.latencyMs, 0);

type SavedAttempt = { status: "ok" | "failed"; model_version: string | null; error: string | null; usage: { input_tokens: number; output_tokens: number } | null; latency_ms: number; cost_usd: number | null; output: unknown; raw?: string | null };
type Saved = SavedAttempt & { case: string; model: string; run?: number; contract_hash: string; attempts?: SavedAttempt[]; contract?: BriefingContract };
const callFrom = (x: SavedAttempt, model: string): BriefingCall => x.status === "ok" && x.output
  ? { status: "ok", output: x.output as BriefingOutput, raw: JSON.stringify(x.output), model: x.model_version ?? model, usage: x.usage ?? { input_tokens: 0, output_tokens: 0 }, latencyMs: x.latency_ms, costUsd: x.cost_usd ?? 0 }
  : { status: "failed", error: x.error ?? "unknown", raw: x.raw ?? (x.output ? JSON.stringify(x.output) : null), model: x.model_version, usage: x.usage, latencyMs: x.latency_ms, costUsd: x.cost_usd };

if (rescore) {
  // Saved briefs are re-validated against the exact contract each was written from (saved, stored by hash, or rebuilt;
  // fresh retrieval is not bit-reproducible, so a case can have more than one contract version). A brief whose contract
  // cannot be found is counted and left out rather than scored against another. A later file's brief for the same
  // model, case and run replaces an earlier one (a retry after a provider outage).
  const saved = [...new Map(rescore.flatMap((p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Saved)
    // runs on a later prompt are named with it, so a model's v1 and v2 briefs are scored side by side, not merged
    .map((x) => (/-v(\d+)-/.test(p) ? { ...x, model: `${x.model} (briefing.v${p.match(/-v(\d+)-/)![1]})` } : x))).map((x) => [`${x.model}|${x.case}|${x.run ?? 1}`, x])).values()];
  models.splice(0, models.length, ...[...new Set(saved.map((x) => x.model))]);
  const byHash = new Map<string, BriefingContract>();
  for (const x of saved) {
    if (x.contract) byHash.set(x.contract_hash, x.contract);
    else if (existsSync(contractPath(x.contract_hash))) byHash.set(x.contract_hash, JSON.parse(readFileSync(contractPath(x.contract_hash), "utf8")) as BriefingContract);
  }
  try {
    for (const c of cases) {
      const wanted = new Set(saved.filter((x) => x.case === c.id && !byHash.has(x.contract_hash)).map((x) => x.contract_hash));
      for (let attempt = 1; wanted.size && attempt <= 6; attempt++) {
        const contract = await withRetry(`contract ${c.id}`, () => contractFor(c));
        const h = briefingContractHash(contract);
        byHash.set(h, contract);
        wanted.delete(h);
      }
      if (wanted.size) console.log(`  ${c.id}: ${wanted.size} saved contract version(s) not reproduced in 6 rebuilds`);
    }
  } finally { await sql.end(); }
  let unreproduced = 0;
  for (const x of saved) {
    if (!cases.some((c) => c.id === x.case)) continue;
    const contract = byHash.get(x.contract_hash);
    if (!contract) { unreproduced++; continue; }
    const attempts = (x.attempts ?? [x]).map((a) => {
      const call = callFrom(a, x.model);
      // as in production: an answer that came back but did not parse is still validated (as a schema failure)
      const answer = call.status === "ok" ? call.output : (() => { try { return call.raw ? JSON.parse(call.raw) : undefined; } catch { return undefined; } })();
      return { call, validation: answer === undefined ? null : validateBrief(contract, x.contract_hash, answer) };
    });
    const final = attempts.at(-1)!;
    rows.push({ model: x.model, case: x.case, run: x.run ?? 1, hash: x.contract_hash, contract, result: { attempts, final, outcome: final.validation?.outcome === "validated" ? "validated" : "fallback" } });
  }
  console.log(`revalidated ${rows.length} briefs from ${rescore.length} files; left out because their contract could not be found: ${unreproduced}`);
  write();
  process.exit(0);
}

const report = (c: GoldCase, model: string, run: number, result: ValidatedBrief) => {
  const hard = result.final.validation?.runs.filter((r) => r.effect === "brief_failed").map((r) => r.validator) ?? [];
  const last = result.final.call;
  console.log(`${c.id} r${run} ${model.padEnd(18)} ${result.outcome.padEnd(9)} attempts ${result.attempts.length} ${String(latencyOf(result)).padStart(6)} ms  $${costOf(result).toFixed(4)}${last.status === "failed" ? `  ${last.error.slice(0, 100)}` : ""}${hard.length ? `  failed: ${hard.join(", ")}` : ""}`);
};

try {
  if (batch) {
    const notClaude = models.filter((m) => !BRIEFING_PRICES[m]);
    if (notClaude.length) throw new Error(`--batch is for Claude models only; drop ${notClaude.join(", ")}`);
    // Every contract first, then every brief at once, so first attempts share one batch and repairs the next.
    const built = [];
    for (const c of cases) {
      const contract = await withRetry(`contract ${c.id}`, () => contractFor(c));
      const hash = briefingContractHash(contract);
      built.push({ c, contract, hash, schema: briefingOutputSchemaFor(contract, hash) });
    }
    const batcher = briefingBatcher({
      log: (m) => console.log(m),
      approve: (n, worst) => { if (spent + worst > maxUsd) throw new Error(`spend cap: ${n} request(s) could cost up to $${worst.toFixed(2)} on top of $${spent.toFixed(2)}, over $${maxUsd}`); spent += worst; },
    });
    await Promise.all(built.flatMap(({ c, contract, hash, schema }) => models.flatMap((model) => Array.from({ length: runs }, async (_, i) => {
      const result = await writeValidatedBrief({ contract, contractHash: hash, write: (repair) => batcher.write({ contract, contractHash: hash, system, model, schema, ...(repair ? { repair } : {}), ...(effort ? { effort } : {}) }) });
      rows.push({ model, case: c.id, run: i + 1, hash, contract, result });
      report(c, model, i + 1, result);
    }))));
    spent = rows.reduce((sum, r) => sum + costOf(r.result), 0); // actual, replacing the worst-case reservations
  } else for (const c of cases) {
    const contract = await withRetry(`contract ${c.id}`, () => contractFor(c));
    const hash = briefingContractHash(contract);
    const schema = briefingOutputSchemaFor(contract, hash);
    for (const model of models) for (let run = 1; run <= runs; run++) {
      if (spent >= maxUsd) throw new Error(`spend cap reached: $${spent.toFixed(2)} of $${maxUsd}; stopping before ${c.id} on ${model}`);
      const result = await writeValidatedBrief({
        contract, contractHash: hash,
        write: (repair) => OPENROUTER_PRICES[model]
          ? writeBriefOpenRouter({ contract, contractHash: hash, system, model, schema, apiKey: process.env["OPENROUTER_API_KEY"], allowRetention: allowRetention.includes(model), ...(repair ? { repair } : {}), ...(effort ? { effort } : {}) })
          : writeBrief({ contract, contractHash: hash, system, model, schema, ...(repair ? { repair } : {}), ...(effort ? { effort } : {}) }),
      });
      spent += costOf(result);
      rows.push({ model, case: c.id, run, hash, contract, result });
      report(c, model, run, result);
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
  const VALIDATORS = ["schema", "contract_hash", "status_lock", "citation_membership", "uncited_claim", "numeric_alignment", "action_allowlist", "banned_phrases", "finding_coverage", "abstention", "unknown_as_pass"];
  const summary = models.map((m) => {
    const r = rows.filter((x) => x.model === m);
    const validated = r.filter((x) => x.result.outcome === "validated").length;
    const repaired = r.filter((x) => x.result.attempts.length > 1).length;
    const repairedOk = r.filter((x) => x.result.attempts.length > 1 && x.result.outcome === "validated").length;
    const noAnswer = r.filter((x) => !x.result.final.validation).length;
    return `| ${m} | ${r.length} | **${pct(validated / r.length)}** | ${repaired} (${repairedOk} fixed) | ${noAnswer} | ${(p95(r.map((x) => latencyOf(x.result))) / 1000).toFixed(1)} s | $${mean(r.map((x) => costOf(x.result))).toFixed(4)} | $${r.reduce((a, x) => a + costOf(x.result), 0).toFixed(2)} |`;
  });
  // What each validator did to the final attempts: hard failures, and sentences or actions it removed.
  const perValidator = models.map((m) => {
    const finals = rows.filter((x) => x.model === m).map((x) => x.result.final.validation).filter((v): v is NonNullable<typeof v> => v !== null);
    return `| ${m} | ${VALIDATORS.map((name) => {
      const runsFor = finals.map((v) => v.runs.find((x) => x.validator === name)).filter(Boolean);
      const hard = runsFor.filter((x) => x!.effect === "brief_failed").length;
      const removed = runsFor.reduce((a, x) => a + (x!.effect === "sentence_removed" || x!.effect === "action_removed" ? x!.removed_sentence_ids.length : 0), 0);
      return hard || removed ? `${hard ? `**${hard}**` : "0"}${removed ? ` / ${removed}` : ""}` : "·";
    }).join(" | ")} |`;
  });
  const maxRun = Math.max(...rows.map((x) => x.run));
  const flips = models.map((m) => {
    const byCase = cases.map((c) => rows.filter((x) => x.model === m && x.case === c.id)).filter((xs) => xs.length);
    const flipping = byCase.filter((xs) => new Set(xs.map((x) => x.result.outcome)).size > 1).map((xs) => xs[0]!.case);
    return `| ${m} | ${byCase.length} | ${flipping.length}${flipping.length ? ` (${flipping.join(", ")})` : ""} |`;
  });
  const cell = (x: Row | undefined) => {
    if (!x) return "";
    const v = x.result.final.validation;
    if (!v) return `– ${x.result.final.call.status === "failed" ? x.result.final.call.error.slice(0, 40) : ""}`;
    const hard = v.runs.filter((r) => r.effect === "brief_failed").map((r) => r.validator);
    return `${x.result.outcome === "validated" ? "✓" : `✗ ${hard.join(", ")}`}${x.result.attempts.length > 1 ? " (repaired)" : ""}`;
  };
  const lines = [
    `# Briefing model evaluation — ${date}`, "",
    `Prompt \`${promptVersion}\`, schema \`briefing_output.v1\` with each contract's own output schema, effort ${effort ?? "model default"}${batch ? ", Message Batches API (half price; latency is time to batch completion)" : ""}, ${cases.length} gold case(s)${maxRun > 1 ? `, ${maxRun} runs per case` : ""}. Every brief ran the production path: the eleven 05 §7 validators (with decision 015's refinements) and at most one repair; "validated" means a user would see the model's brief, anything else means the templated brief. Measured by \`pnpm briefing:eval\`.`, "",
    "| Model | Briefs | Validated | Repaired (fixed) | No answer | p95 latency (incl. repair) | Cost per brief (incl. repair) | Cost this run |",
    "|---|---|---|---|---|---|---|---|",
    ...summary, "",
    "What each validator did to the final attempts: **hard failures** (brief fell back) / sentences or actions removed.", "",
    `| Model | ${VALIDATORS.join(" | ")} |`, `|---|${VALIDATORS.map(() => "---").join("|")}|`, ...perValidator, "",
    ...(maxRun > 1 ? ["Consistency across runs: cases whose outcome differed between runs.", "", "| Model | Cases | Cases that flipped |", "|---|---|---|", ...flips, ""] : []),
    "Per case (✓ validated, ✗ fell back, with the validators that failed it; – no answer):", "",
    `| Case | ${models.flatMap((m) => (maxRun > 1 ? Array.from({ length: maxRun }, (_, i) => `${m} r${i + 1}`) : [m])).join(" | ")} |`,
    `|---|${models.flatMap(() => Array.from({ length: maxRun }, () => "---")).join("|")}|`,
    ...cases.filter((c) => rows.some((r) => r.case === c.id)).map((c) => `| ${c.id} | ${models.flatMap((m) => Array.from({ length: maxRun }, (_, i) => cell(rows.find((x) => x.case === c.id && x.model === m && x.run === i + 1)))).join(" | ")} |`),
    "", `Banned phrases checked: ${BANNED_PHRASES.join(", ")}. Prices per million input / output tokens: ${Object.entries(BRIEFING_PRICES).map(([m, p]) => `${m} $${p.input} / $${p.output}`).join(", ")} (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except ${allowRetention.length ? allowRetention.join(", ") : "none"}) ${Object.entries(OPENROUTER_PRICES).map(([m, p]) => `${m} $${p.input} / $${p.output}`).join(", ")} (list prices; open-weight hosts vary). Every attempt, its validator results and the final brief are in \`briefings-${suffix}.jsonl\`; contracts are stored by hash in \`docs/eval/.contracts\` (not committed).`, "",
  ];
  mkdirSync(join(root, "docs", "eval", ".contracts"), { recursive: true });
  for (const r of rows) if (r.contract && !existsSync(contractPath(r.hash))) writeFileSync(contractPath(r.hash), JSON.stringify(r.contract));
  writeFileSync(join(root, "docs", "eval", `briefing-model-${suffix}.md`), lines.join("\n"));
  const attemptJson = (a: ValidatedBrief["attempts"][number]) => ({
    status: a.call.status, model_version: a.call.model, error: a.call.status === "failed" ? a.call.error : null, usage: a.call.usage, latency_ms: a.call.latencyMs, cost_usd: a.call.costUsd,
    output: a.call.status === "ok" ? a.call.output : null, raw: a.call.status === "failed" ? a.call.raw : null, outcome: a.validation?.outcome ?? null,
    validators: a.validation?.runs.map((r) => ({ validator: r.validator, result: r.result, effect: r.effect, removed: r.removed_sentence_ids, detail: r.detail })) ?? null,
  });
  writeFileSync(join(root, "docs", "eval", `briefings-${suffix}.jsonl`), rows.map((r) => JSON.stringify({
    case: r.case, model: r.model, run: r.run, contract_hash: r.hash,
    ...attemptJson(r.result.final), outcome: r.result.outcome, attempts: r.result.attempts.map(attemptJson), validated_brief: r.result.final.validation?.brief ?? null,
  })).join("\n") + "\n");
  console.log(`\nreport: docs/eval/briefing-model-${suffix}.md  spent $${spent.toFixed(2)}`);
}
