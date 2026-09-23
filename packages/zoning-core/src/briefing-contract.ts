import { createHash } from "node:crypto";
import {
  BANNED_PHRASES, BriefingContract, canonicalJson,
  type ActionId, type Coverage, type DecisionPolicy, type EvidenceBundle, type FinalStatus, type Finding, type JevRisk, type JevRoute, type ScenarioInputs,
} from "@parcelpilot/contracts";
import { DISCLAIMER } from "./memo/copy.ts";

// The frozen briefing contract (MOO-837; 05 §5): the only input the briefing model sees. Built from a locked run, and
// refused otherwise. Its only text from the corpus is the run's frozen evidence bundle, excerpt for excerpt.

export type BriefingRunRecord = {
  run: { id: string; locked_at: string | null; final_status: FinalStatus; route: JevRoute; risk: JevRisk | null; reasons: string[]; triggers: string[]; coverage: Coverage };
  parcel: { taxkey: string; address: string | null; lot_area_sqft: number | null; base_zoning: string[]; retrieved_at: string | null };
  scenario: ScenarioInputs;
  findings: Array<{ finding: Finding; calculation_id: string | null }>;
  bundle: EvidenceBundle | null;
  jev: { overall_risk: "low" | "medium" | "high"; recommended_route: JevRoute; confidence: number } | null;
};

const OPS: Record<string, string> = { "<=": "≤", ">=": "≥", "==": "=", in: "in" };
const show = (v: { value: number | string; unit?: string | undefined } | undefined, op?: string) =>
  v ? `${op ? `${OPS[op] ?? op} ` : ""}${typeof v.value === "number" ? v.value.toLocaleString("en-US") : v.value}${v.unit ? ` ${v.unit}` : ""}` : null;

// A finding's excerpts: the chunks its own citations point at, else the signed-off rule rows retrieval pinned for it.
function sourceIdsFor(f: Finding, items: EvidenceBundle["items"]): string[] {
  const cited = items.filter((i) => f.citations.some((c) => c.document_id === i.document_sha256 && c.section === i.section));
  const chosen = cited.length ? cited : items.filter((i) => i.category === f.category && i.selection_reason.includes("signed-off rule"));
  return [...new Set(chosen.map((i) => i.source_id))];
}

// Allowed next actions (decision 013): the status list, plus trigger, verification and missing-input additions, except
// for insufficient_evidence, where only the status list applies (the abstention check, 05 §7).
export function allowedNextActions(policy: DecisionPolicy, i: { status: FinalStatus; triggers: string[]; findings: Finding[] }): ActionId[] {
  const t = policy.allowed_next_actions;
  const base = t.by_status[i.status] ?? [];
  if (i.status === "insufficient_evidence") return [...base];
  return [...new Set([
    ...base,
    ...i.triggers.flatMap((tr) => t.by_trigger_kind[tr.split(":")[0]!] ?? []),
    ...i.findings.filter((f) => f.status === "verify").flatMap((f) => t.by_category_needing_verification[f.category] ?? []),
    ...(i.findings.some((f) => f.missing_inputs.length) ? t.when_missing_inputs : []),
  ])];
}

export function buildBriefingContract(r: BriefingRunRecord, policy: DecisionPolicy): BriefingContract {
  if (!r.run.locked_at) throw new Error(`run ${r.run.id} is not locked: a brief may only explain a locked decision`);
  const items = r.bundle?.items ?? [];
  const findings = r.findings.map((x) => x.finding);
  return BriefingContract.parse({
    version: "briefing_contract.v1",
    run_id: r.run.id,
    final_decision: { status: r.run.final_status, risk: r.run.risk, route: r.run.route, status_is_locked: true },
    parcel_facts: {
      taxkey: r.parcel.taxkey, address: r.parcel.address, lot_area_sqft: r.parcel.lot_area_sqft, base_zoning: r.parcel.base_zoning.join(" / ") || null,
      overlays: r.run.triggers.filter((t) => /^(overlay|floodplain|special_district|planned_development):/.test(t)).map((t) => t.split(":").slice(1).join(":")),
      facts_retrieved_at: r.parcel.retrieved_at,
    },
    scenario: Object.fromEntries(Object.entries(r.scenario).filter(([, v]) => v !== undefined)),
    verified_findings: r.findings.map(({ finding: f, calculation_id }, n) => ({
      finding_id: `f${n + 1}`, category: f.category, status: f.status,
      proposed: show(f.proposed), allowed: show(f.allowed, f.allowed?.operator), calculation_id, source_ids: sourceIdsFor(f, items),
    })),
    manual_review_triggers: r.run.triggers.map((t, n) => ({ trigger_id: `t${n + 1}`, kind: t.split(":")[0]!, code: t.split(":").slice(1).join(":"), source_ids: [] })),
    unknown_or_unsupported_categories: r.run.coverage.unknown,
    missing_inputs: [...new Set(findings.flatMap((f) => f.missing_inputs))],
    jev_decision: r.jev ? { selected_values: { overall_risk: r.jev.overall_risk, recommended_route: r.jev.recommended_route }, confidence: r.jev.confidence, may_not_override_policy: true } : null,
    policy_reasons: r.run.reasons,
    evidence_bundle: items.map((i) => ({ source_id: i.source_id, official_url: i.official_url, document_title: i.document_title, section: i.section, page: i.page, verbatim_excerpt: i.verbatim_excerpt, status: i.status })),
    allowed_next_actions: allowedNextActions(policy, { status: r.run.final_status, triggers: r.run.triggers, findings }),
    required_disclaimer: DISCLAIMER,
    banned_phrases: [...BANNED_PHRASES],
  });
}

export const briefingContractHash = (c: BriefingContract) => createHash("sha256").update(canonicalJson(c)).digest("hex");
