import { z } from "zod";
import type { BriefingContract } from "@parcelpilot/contracts";
import { postSystemOne, systemOneCost } from "../jev-client.ts";
import { sentencesOf, validateBrief, withoutSentences, type BriefValidation, type ValidatorRun } from "./brief.ts";

// The twelfth brief check (MOO-841; 05 §7 citation_support; decision 017). The eleven deterministic checks prove a cited
// source is in the bundle; this one asks JEV whether the cited excerpt actually says what the sentence claims. It runs
// on a brief the eleven already passed, and can only take sentences away. Off unless CITATION_SUPPORT_CHECK=true.
// Question wording and the 0.8 line are the TypeSafe citation-check cookbook's (docs.typesafe.ai, read 2026-09-23).

export const citationSupportEnabled = (env: Record<string, string | undefined> = process.env) => env["CITATION_SUPPORT_CHECK"] === "true";

export const CITATION_SUPPORT_MODEL = "jev-1.13.0"; // pinned: the 0.8 threshold is measured against this version
export const CITATION_SUPPORT_AUTO_AT = 0.8; // at or above: the verdict stands; below: removed and sampled by a reviewer
export const CITATION_SUPPORT_TIMEOUT_MS = 10_000; // ponytail: one request per brief; move into the decision policy if it needs tuning
const CHECKED_KINDS = new Set(["fact", "code", "finding"]);
const CRITERIA = {
  supports: "The section states the claim or directly implies that it is true",
  contradicts: "The section states the opposite of the claim or implies it is false",
  says_nothing: "The section does not address what the claim asserts, either way",
} as const;
type Relation = keyof typeof CRITERIA;

export type SupportPair = { sentence_id: string; kind: string; source_id: string; claim: string; section: string };
export type SupportAnswer = { choice: Relation; confidence: number; probabilities: Record<string, number> };

// One pair per (surviving checked sentence, excerpt it cites). Ids match the bundle case-insensitively, as elsewhere.
export function supportPairs(contract: BriefingContract, validation: BriefValidation): SupportPair[] {
  if (!validation.brief) return [];
  const bundle = new Map(contract.evidence_bundle.map((e) => [e.source_id.toLowerCase(), e]));
  return sentencesOf(validation.brief).filter((x) => CHECKED_KINDS.has(x.s.kind)).flatMap((x) => x.s.source_ids.flatMap((id) => {
    const e = bundle.get(id.toLowerCase());
    return e ? [{ sentence_id: x.id, kind: x.s.kind, source_id: e.source_id, claim: x.s.text, section: `${e.document_title}, ${e.section}: ${e.verbatim_excerpt}` }] : [];
  }));
}

// All pairs in one request: the state lists each claim and each excerpt once, and question p<i> points at its pair.
export function supportRequest(pairs: SupportPair[]) {
  const claims = [...new Set(pairs.map((p) => p.claim))];
  const sections = [...new Set(pairs.map((p) => p.section))];
  return {
    model: CITATION_SUPPORT_MODEL,
    state: { claims, sections },
    questions: Object.fromEntries(pairs.map((p, i) => [`p${i}`, {
      type: "choice",
      instructions: `How does the section \`sections[${sections.indexOf(p.section)}]\` relate to the claim \`claims[${claims.indexOf(p.claim)}]\`?`,
      criteria: CRITERIA,
    }])),
  };
}

const Answer = z.looseObject({ choice: z.enum(["supports", "contradicts", "says_nothing"]), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number()) });
const Response = z.looseObject({ model: z.string(), answers: z.record(z.string(), Answer), usage: z.looseObject({ input_tokens: z.number().int().nonnegative() }) });

export type SupportCall =
  | { status: "ok"; answers: SupportAnswer[]; model: string; latencyMs: number; inputTokens: number; costUsd: number }
  | { status: "failed"; error: string; latencyMs: number };

export async function askCitationSupport(pairs: SupportPair[], opts: { apiKey: string | undefined; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<SupportCall> {
  const call = await postSystemOne(supportRequest(pairs), { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs ?? CITATION_SUPPORT_TIMEOUT_MS, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
  if (call.status === "failed") return { status: "failed", error: call.error, latencyMs: call.latencyMs };
  const parsed = Response.safeParse(call.raw);
  if (!parsed.success) return { status: "failed", error: `schema-invalid response: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`, latencyMs: call.latencyMs };
  const answers = pairs.map((_, i) => parsed.data.answers[`p${i}`]);
  if (answers.some((a) => !a)) return { status: "failed", error: "an answer is missing", latencyMs: call.latencyMs };
  return { status: "ok", answers: answers as SupportAnswer[], model: parsed.data.model, latencyMs: call.latencyMs, inputTokens: parsed.data.usage.input_tokens, costUsd: systemOneCost(parsed.data.usage.input_tokens) };
}

// The verdict for a brief, from JEV's answers (pure; the tests drive it directly).
// - A sentence stays if any excerpt it cites supports it (a sentence can rest on two rows).
// - Otherwise it goes. If every one of its answers is at or above 0.8 the removal stands; if not, it is also sampled
//   for review (review_sentence_ids → pointer-only review_tasks, decision 017).
// - Losing a finding sentence fails the brief; so does the eleven failing on what is left, or JEV not answering.
export function applyCitationSupport(contract: BriefingContract, contractHash: string, validation: BriefValidation, pairs: SupportPair[], call: SupportCall | null): BriefValidation {
  if (validation.outcome !== "validated" || !validation.brief) return validation;
  const run = (r: Omit<ValidatorRun, "validator">): ValidatorRun => ({ validator: "citation_support", ...r });
  if (!pairs.length) return { ...validation, runs: [...validation.runs, run({ result: "pass", effect: "none", removed_sentence_ids: [], detail: { pairs: [] } })] };
  if (!call || call.status === "failed") {
    return { outcome: "fallback", brief: null, runs: [...validation.runs, run({ result: "skipped", effect: "brief_failed", removed_sentence_ids: [], detail: { error: call?.error ?? "not asked", latency_ms: call?.latencyMs ?? null } })] };
  }
  const bySentence = new Map<string, { kind: string; answers: SupportAnswer[] }>();
  pairs.forEach((p, i) => {
    const s = bySentence.get(p.sentence_id) ?? { kind: p.kind, answers: [] };
    bySentence.set(p.sentence_id, { ...s, answers: [...s.answers, call.answers[i]!] });
  });
  const removed = [...bySentence].filter(([, s]) => !s.answers.some((a) => a.choice === "supports"));
  const review = removed.filter(([, s]) => s.answers.some((a) => a.confidence < CITATION_SUPPORT_AUTO_AT)).map(([id]) => id);
  const removedIds = removed.map(([id]) => id);
  const findingLost = removed.some(([, s]) => s.kind === "finding");
  const cleaned = validateBrief(contract, contractHash, withoutSentences(validation.brief, new Set(removedIds)));
  const recheckFailed = cleaned.runs.filter((r) => r.effect === "brief_failed").map((r) => r.validator);
  const hard = findingLost || cleaned.outcome !== "validated";
  const detail = {
    model: call.model, latency_ms: call.latencyMs, input_tokens: call.inputTokens, cost_usd: call.costUsd,
    pairs: pairs.map((p, i) => ({ sentence_id: p.sentence_id, kind: p.kind, source_id: p.source_id, ...call.answers[i]! })),
    review_sentence_ids: review, finding_removed: findingLost, recheck_failed: recheckFailed,
  };
  return {
    outcome: hard ? "fallback" : "validated", brief: hard ? null : cleaned.brief,
    runs: [...validation.runs, run({ result: removedIds.length || hard ? "fail" : "pass", effect: hard ? "brief_failed" : removedIds.length ? "sentence_removed" : "none", removed_sentence_ids: removedIds, detail })],
  };
}

// Ask and apply, for the pipeline: a brief the eleven passed → the same brief with unsupported sentences removed.
export async function checkCitationSupport(contract: BriefingContract, contractHash: string, validation: BriefValidation, opts: { apiKey: string | undefined; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<BriefValidation> {
  if (validation.outcome !== "validated") return validation;
  const pairs = supportPairs(contract, validation);
  const call = pairs.length ? await askCitationSupport(pairs, opts) : null;
  return applyCitationSupport(contract, contractHash, validation, pairs, call);
}
