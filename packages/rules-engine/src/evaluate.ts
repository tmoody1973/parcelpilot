import {
  DEFAULT_CRITICALITY, EvaluateInput, type CalculationRecord, type Coverage, type Criticality, type EvaluateOutput, type Finding, type FindingStatus, type RuleCategory, type ZoningRule,
} from "@parcelpilot/contracts";
import { applyConditions } from "./conditions.ts";
import type { FactContext } from "./facts.ts";
import { checkRule } from "./kinds.ts";

// Strictest first. A pass can never hide anything else in the same category (PRD F-03).
const SEVERITY: readonly FindingStatus[] = ["fail", "insufficient_evidence", "verify", "unknown", "pass"];
const CRIT_ORDER: readonly Criticality[] = ["critical", "high", "medium", "low"];
const BUCKET: Record<FindingStatus, keyof Coverage> = { pass: "checked", fail: "checked", verify: "manual_review", insufficient_evidence: "manual_review", unknown: "unknown" };

const worst = <T extends string>(order: readonly T[], xs: T[]): T => xs.reduce((a, b) => (order.indexOf(b) < order.indexOf(a) ? b : a));

function inForce(rule: ZoningRule, date: string): boolean {
  return rule.status === "approved" && rule.effective_start <= date && (rule.effective_end === null || rule.effective_end > date);
}

function criticalityFor(category: RuleCategory, rules: ZoningRule[]): Criticality {
  return rules.length ? worst(CRIT_ORDER, rules.map((r) => r.criticality)) : DEFAULT_CRITICALITY[category];
}

function evaluateCategory(category: RuleCategory, rules: ZoningRule[], ctx: FactContext): { finding: Finding; calculations: CalculationRecord[] } {
  const criticality = criticalityFor(category, rules);
  if (rules.length === 0) return { finding: { category, status: "unknown", criticality, calculation_ids: [], citations: [], reason: "no_rule", missing_inputs: [], confidence: "low" }, calculations: [] };

  const runs = rules.map((rule) => {
    const cond = applyConditions(rule, ctx);
    const check = cond.verify ? null : checkRule(rule, cond.params, ctx);
    const status: FindingStatus = cond.verify ? "verify" : check!.status;
    const reason = cond.verify ? cond.reason : check?.reason;
    const calc: CalculationRecord = {
      id: `${category}:${rule.id}`, category, rule_id: rule.id, rule_version: rule.version, kind: rule.kind,
      inputs: check?.inputs ?? {}, proposed: check?.proposed?.value ?? null, allowed: check?.allowed?.value ?? null, operator: check?.allowed?.operator ?? null,
      status, detail: reason ? `${check?.detail ?? "condition"} [${reason}]` : check!.detail, conditions_applied: cond.applied,
    };
    return { rule, check, status, reason, calc };
  });

  const status = worst(SEVERITY, runs.map((r) => r.status));
  const decisive = runs.find((r) => r.status === status)!;
  const settled = status === "pass" || status === "fail";
  const finding: Finding = {
    category, status, criticality,
    rule_id: decisive.rule.id, rule_version: decisive.rule.version,
    ...(decisive.check?.proposed ? { proposed: decisive.check.proposed } : {}),
    ...(decisive.check?.allowed ? { allowed: decisive.check.allowed } : {}),
    calculation_ids: runs.map((r) => r.calc.id),
    citations: decisive.rule.citations,
    ...(decisive.reason ? { reason: decisive.reason } : {}),
    missing_inputs: [...new Set(runs.flatMap((r) => r.check?.missing_inputs ?? []))],
    confidence: settled ? (decisive.calc.conditions_applied.length ? "medium" : "high") : "low",
  };
  return { finding, calculations: runs.map((r) => r.calc) };
}

// Pure: same input → same output. No clock, no DB, no network (02 §3 invariant 1).
export function evaluate(raw: EvaluateInput): EvaluateOutput {
  const input = EvaluateInput.parse(raw);
  const ctx: FactContext = { parcel: input.parcel, scenario: input.scenario };
  const districts = input.parcel.base_zoning;
  const live = input.rules.filter((r) => inForce(r, input.analysis_date) && districts.includes(r.district_code));

  const results = input.categories_in_scope.map((category) => {
    // Sorted by family so the decisive rule (and the allowed value a pass shows) never depends on load order.
    const rules = live.filter((r) => r.category === category).sort((a, b) => a.family_id.localeCompare(b.family_id) || a.version - b.version);
    if (districts.length > 1) {
      const finding: Finding = { category, status: "verify", criticality: criticalityFor(category, rules), calculation_ids: [], citations: [], reason: "multiple_districts", missing_inputs: [], confidence: "low" };
      return { finding, calculations: [] as CalculationRecord[] };
    }
    return evaluateCategory(category, rules, ctx);
  });

  const findings = results.map((r) => r.finding);
  const inBucket = (b: keyof Coverage) => findings.filter((f) => BUCKET[f.status] === b).map((f) => f.category);
  const coverage: Coverage = { checked: inBucket("checked"), manual_review: inBucket("manual_review"), unknown: inBucket("unknown") };
  return { findings, calculations: results.flatMap((r) => r.calculations), coverage };
}
