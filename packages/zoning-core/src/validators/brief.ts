import { BriefingOutput, findBannedPhrases, type BriefingContract, type CitedSentence, type ValidationEffect, type ValidationResult, type ValidatorName } from "@parcelpilot/contracts";
import { numbersInValue, stripIds, IDENTIFIERS } from "./text.ts";

// The eleven deterministic brief validators (MOO-838; 05 §7). They run in the order of the §7 table, each on the brief
// the previous one left, and each reports what it did. A sentence can be removed; an action can be removed; or the
// whole brief fails and the templated brief is shown instead. A validator that throws is a hard failure, never a pass.

export type ValidatorRun = { validator: ValidatorName; result: ValidationResult; effect: ValidationEffect; removed_sentence_ids: string[]; detail: Record<string, unknown> };
export type BriefValidation = { outcome: "validated" | "fallback"; brief: BriefingOutput | null; runs: ValidatorRun[] };

// Every sentence in a brief, addressed by where it sits. These ids are what validation_runs records.
type Located = { id: string; section: "executive_summary" | "status_explanation" | "verified_findings" | "open_questions" | "suggested_actions" | "questions_for_experts"; s: CitedSentence };
export function sentencesOf(b: BriefingOutput): Located[] {
  return [
    ...b.executive_summary.map((s, i) => ({ id: `executive_summary[${i}]`, section: "executive_summary" as const, s })),
    ...b.status_explanation.map((s, i) => ({ id: `status_explanation[${i}]`, section: "status_explanation" as const, s })),
    ...b.verified_findings.flatMap((v, j) => v.sentences.map((s, i) => ({ id: `verified_findings[${j}].sentences[${i}]`, section: "verified_findings" as const, s }))),
    ...b.open_questions.map((s, i) => ({ id: `open_questions[${i}]`, section: "open_questions" as const, s })),
    ...b.suggested_actions.map((a, i) => ({ id: `suggested_actions[${i}].rationale`, section: "suggested_actions" as const, s: a.rationale })),
    ...b.questions_for_experts.map((q, i) => ({ id: `questions_for_experts[${i}].question`, section: "questions_for_experts" as const, s: q.question })),
  ];
}

// A new brief without the given sentences. An action or expert question whose sentence goes is removed with it.
export function withoutSentences(b: BriefingOutput, ids: Set<string>): BriefingOutput {
  const keep = (prefix: string) => <T,>(_: T, i: number) => !ids.has(`${prefix}[${i}]`);
  return {
    ...b,
    executive_summary: b.executive_summary.filter(keep("executive_summary")),
    status_explanation: b.status_explanation.filter(keep("status_explanation")),
    verified_findings: b.verified_findings.map((v, j) => ({ ...v, sentences: v.sentences.filter((_, i) => !ids.has(`verified_findings[${j}].sentences[${i}]`)) })),
    open_questions: b.open_questions.filter(keep("open_questions")),
    suggested_actions: b.suggested_actions.filter((_, i) => !ids.has(`suggested_actions[${i}].rationale`)),
    questions_for_experts: b.questions_for_experts.filter((_, i) => !ids.has(`questions_for_experts[${i}].question`)),
  };
}

const CLAIM = new Set(["fact", "code", "finding"]);
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase(); // structured outputs may change enum casing

// The numbers a brief may print (05 §7 numeric_alignment): the calculation values as displayed, the parcel facts and
// the user's own scenario inputs. Never numbers read from an excerpt, and never arithmetic.
const factNumbers = (c: BriefingContract) => numbersInValue([c.verified_findings.map((f) => [f.proposed, f.allowed]), c.parcel_facts, c.scenario]);
// Plain counts of the contract's own lists ("2 of the 3 findings") are allowed too, but only for a number that is not a
// measurement: "1 ft over" is arithmetic even though 1 is also a count.
const countNumbers = (c: BriefingContract) => new Set([8, c.verified_findings.length, c.unknown_or_unsupported_categories.length, c.missing_inputs.length, c.manual_review_triggers.length,
  ...(["pass", "fail", "verify", "unknown", "insufficient_evidence"] as const).map((st) => c.verified_findings.filter((f) => f.status === st).length),
  c.verified_findings.filter((f) => f.status !== "unknown").length].map(String)); // e.g. "2 of the 3 findings were reviewed"
const UNIT_AFTER = /^\s*-?\s*(ft\b|feet\b|foot\b|sq\b|square\b|%|percent\b|stor(y|ies)\b|units?\b|spaces?\b|acres?\b)/i;
function numbersInSentence(text: string): Array<{ n: string; measured: boolean }> {
  const t = stripIds(text).replace(IDENTIFIERS, " ");
  return [...t.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/g)].map((m) => ({ n: m[0].replaceAll(",", ""), measured: UNIT_AFTER.test(t.slice(m.index! + m[0].length)) }));
}

// Refinement of 05 §7 (MOO-838): the rule stops a brief implying an unchecked category passed. A clause that mentions
// the category and says it passed or meets a standard fails the brief; "parking was not checked" does not.
const PASS_CLAIM = /\b(pass(es|ed)?|meets?|met|compl(y|ies|ied)|within|satisf(y|ies|ied)|conforms?|clears?|fits?)\b/i;
const NOT_CHECKED = /\b(not|no|unchecked|unknown|unresolved|unreviewed|without)\b/i;
// A requirement ("parking must meet s. 295-403-2") states a rule, not a result.
const OBLIGATION = /\b(must|shall|should|may|can|could|needs? to|has to|have to|required to|is to|are to)\b.*\b(meet|comply|satisfy|conform|clear|fit|pass)/i; // modal first, then the verb
// Claims, one per clause. Section references are masked first so the period in "s. 295-403-2" does not split a
// sentence, and questions are dropped: "Do the parking spaces meet the standard?" claims nothing.
function claimClauses(t: string): string[] {
  const masked = t.replace(IDENTIFIERS, "§REF");
  return (masked.match(/[^.?!;]+[.?!;]?/g) ?? [])
    .filter((sentence) => !sentence.trim().endsWith("?"))
    .flatMap((sentence) => sentence.split(/,\s*(?:and|but|while|so)\s+|\s+(?:but|while)\s+/i));
}
const CATEGORY_WORDS: Record<string, RegExp> = {
  use: /\buses?\b/i, height: /\bheight\b/i, setback_front: /\bfront setback\b/i, setback_side: /\bside setback\b/i, setback_rear: /\brear setback\b/i,
  density: /\bdensity\b|\blot area per (dwelling )?unit\b/i, parking: /\bparking\b/i, lot_coverage: /\blot coverage\b/i,
};

type Step = { name: ValidatorName; run: (c: BriefingContract, hash: string, b: BriefingOutput) => { hard: boolean; removed?: string[]; removedActions?: number[]; detail?: Record<string, unknown> } };

// The §7 table, in order. `schema` runs first and separately (it decides whether the others can run at all).
const STEPS: Step[] = [
  { name: "contract_hash", run: (_c, hash, b) => ({ hard: b.contract_hash !== hash, detail: b.contract_hash === hash ? {} : { expected: hash, got: b.contract_hash } }) },
  { name: "status_lock", run: (c, _h, b) => ({ hard: b.status_echo !== c.final_decision.status, detail: { expected: c.final_decision.status, got: b.status_echo } }) },
  {
    name: "citation_membership", run: (c, _h, b) => {
      const ids = c.evidence_bundle.map((e) => e.source_id);
      const all = sentencesOf(b);
      const bad = all.filter((x) => x.s.source_ids.some((id) => !ids.some((k) => eq(k, id))));
      // hard for the brief when more than 10% of its sentences cite something outside the contract
      return { hard: all.length > 0 && bad.length / all.length > 0.1, removed: bad.map((x) => x.id), detail: { unknown_ids: [...new Set(bad.flatMap((x) => x.s.source_ids.filter((id) => !ids.some((k) => eq(k, id)))))], share: all.length ? bad.length / all.length : 0 } };
    },
  },
  {
    name: "uncited_claim", run: (_c, _h, b) => {
      const bad = sentencesOf(b).filter((x) => CLAIM.has(x.s.kind) && x.s.source_ids.length === 0);
      return { hard: bad.some((x) => x.s.kind === "finding"), removed: bad.map((x) => x.id) };
    },
  },
  {
    name: "numeric_alignment", run: (c, _h, b) => {
      const facts = factNumbers(c);
      const counts = countNumbers(c);
      // Refinement of 05 §7 (MOO-838): a number quoted from an excerpt the sentence cites is grounded, not computed,
      // so it is allowed for that sentence only. Arithmetic ("roughly 32,000 sq ft") is in no excerpt and is still caught.
      const excerptNumbers = new Map(c.evidence_bundle.map((e) => [e.source_id.toLowerCase(), numbersInValue(e.verbatim_excerpt.replace(IDENTIFIERS, " "))]));
      const cited = (x: CitedSentence) => new Set(x.source_ids.flatMap((id) => [...(excerptNumbers.get(id.toLowerCase()) ?? [])]));
      const allowedIn = (x: CitedSentence) => { const q = cited(x); return (n: { n: string; measured: boolean }) => facts.has(n.n) || q.has(n.n) || (!n.measured && counts.has(n.n)); };
      const display = new Map(c.verified_findings.filter((f) => f.calculation_id).map((f) => [f.calculation_id!, [f.proposed, f.allowed].filter(Boolean) as string[]]));
      const bad = sentencesOf(b).filter((x) =>
        numbersInSentence(x.s.text).some((n) => !allowedIn(x.s)(n))
        // a declared number must be one of its calculation's display strings, word for word
        || (x.s.numbers ?? []).some((n) => !(display.get(n.calculation_id) ?? []).includes(n.value)));
      return { hard: bad.some((x) => x.section === "verified_findings"), removed: bad.map((x) => x.id), detail: { numbers: [...new Set(bad.flatMap((x) => numbersInSentence(x.s.text).filter((n) => !allowedIn(x.s)(n)).map((n) => n.n)))] } };
    },
  },
  {
    name: "action_allowlist", run: (c, _h, b) => {
      const bad = b.suggested_actions.map((a, i) => ({ a, i })).filter(({ a }) => !c.allowed_next_actions.some((k) => eq(k, a.action_id)));
      const left = b.suggested_actions.length - bad.length;
      return { hard: left === 0 && c.final_decision.status !== "proceed_to_concept_design", removedActions: bad.map((x) => x.i), detail: { removed_actions: bad.map((x) => x.a.action_id), remaining: left } };
    },
  },
  {
    name: "banned_phrases", run: (_c, _h, b) => {
      const bad = sentencesOf(b).filter((x) => findBannedPhrases(x.s.text).length > 0);
      return { hard: bad.some((x) => x.section === "executive_summary"), removed: bad.map((x) => x.id), detail: { phrases: [...new Set(bad.flatMap((x) => findBannedPhrases(x.s.text).map((h) => h.phrase)))] } };
    },
  },
  {
    name: "finding_coverage", run: (c, _h, b) => {
      const known = c.verified_findings.map((f) => f.finding_id);
      const strangers = b.verified_findings.map((v) => v.finding_id).filter((id) => !known.some((k) => eq(k, id)));
      // a fail finding is covered only if its entry still has a sentence after earlier validators removed any
      const missingFails = c.verified_findings.filter((f) => f.status === "fail" && !b.verified_findings.some((v) => eq(v.finding_id, f.finding_id) && v.sentences.length > 0)).map((f) => f.finding_id);
      return { hard: strangers.length > 0 || missingFails.length > 0, detail: { unknown_finding_ids: strangers, uncovered_fails: missingFails } };
    },
  },
  {
    name: "abstention", run: (c, _h, b) => {
      if (c.final_decision.status !== "insufficient_evidence") return { hard: false };
      const extraActions = b.suggested_actions.filter((a) => !["collect_missing_information", "contact_city"].some((k) => eq(k, a.action_id))).map((a) => a.action_id);
      const opinions = sentencesOf(b).filter((x) => x.s.kind === "finding").map((x) => x.id);
      return { hard: extraActions.length > 0 || opinions.length > 0, detail: { extra_actions: extraActions, finding_sentences: opinions } };
    },
  },
  {
    name: "unknown_as_pass", run: (c, _h, b) => {
      // Every kind is checked: the model picks the kind, so "Parking meets the standard." labelled as framing must not
      // slip through. A question ("Does parking meet the standard?") is not a claim.
      const hits = sentencesOf(b).filter((x) => claimClauses(x.s.text).some((cl) =>
        c.unknown_or_unsupported_categories.some((cat) => CATEGORY_WORDS[cat]?.test(cl)) && PASS_CLAIM.test(cl) && !NOT_CHECKED.test(cl) && !OBLIGATION.test(cl)));
      return { hard: hits.length > 0, detail: { sentences: hits.map((x) => x.id) } };
    },
  },
];

export function validateBrief(contract: BriefingContract, contractHash: string, raw: unknown): BriefValidation {
  const runs: ValidatorRun[] = [];
  const parsed = BriefingOutput.safeParse(raw);
  runs.push({ validator: "schema", result: parsed.success ? "pass" : "fail", effect: parsed.success ? "none" : "brief_failed", removed_sentence_ids: [],
    detail: parsed.success ? {} : { issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) } });
  if (!parsed.success) {
    for (const s of STEPS) runs.push({ validator: s.name, result: "skipped", effect: "none", removed_sentence_ids: [], detail: { reason: "schema failed" } });
    return { outcome: "fallback", brief: null, runs };
  }
  let brief = parsed.data;
  let failed = false;
  for (const s of STEPS) {
    try {
      const r = s.run(contract, contractHash, brief);
      const removed = r.removed ?? [];
      const removedActions = r.removedActions ?? [];
      if (removed.length) brief = withoutSentences(brief, new Set(removed));
      if (removedActions.length) brief = { ...brief, suggested_actions: brief.suggested_actions.filter((_, i) => !removedActions.includes(i)) };
      failed ||= r.hard;
      const effect: ValidationEffect = r.hard ? "brief_failed" : removed.length ? "sentence_removed" : removedActions.length ? "action_removed" : "none";
      runs.push({ validator: s.name, result: r.hard || removed.length || removedActions.length ? "fail" : "pass", effect,
        removed_sentence_ids: [...removed, ...removedActions.map((i) => `suggested_actions[${i}]`)], detail: r.detail ?? {} });
    } catch (e) {
      failed = true; // a validator that cannot run has not passed anything
      runs.push({ validator: s.name, result: "fail", effect: "brief_failed", removed_sentence_ids: [], detail: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return { outcome: failed ? "fallback" : "validated", brief: failed ? null : brief, runs };
}
