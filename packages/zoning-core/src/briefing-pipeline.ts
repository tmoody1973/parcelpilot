import type { BriefingContract } from "@parcelpilot/contracts";
import type { BriefingCall } from "./briefing-client.ts";
import { validateBrief, type BriefValidation, type ValidatorRun } from "./validators/brief.ts";

// Write → validate → at most one repair (MOO-838). The live path and the evaluation both run this, so the evaluation
// measures exactly what users would get. A repair is only worth a second call when the first answer came back and
// failed a check; an API error or timeout is not repaired (the client already retried it). Whatever the second
// attempt does, the outcome is final: validated, or the templated brief.

export type BriefAttempt = { call: BriefingCall; validation: BriefValidation | null };
export type ValidatedBrief = { attempts: BriefAttempt[]; final: BriefAttempt; outcome: "validated" | "fallback" };

// Plain instructions for the second attempt, built from what each failing validator reported.
export function repairNotes(c: BriefingContract, runs: ValidatorRun[]): string[] {
  const d = (r: ValidatorRun, k: string) => r.detail[k];
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  const notes: Record<string, (r: ValidatorRun) => string> = {
    schema: (r) => `The output did not match the required schema: ${list(d(r, "issues"))}.`,
    contract_hash: () => "contract_hash must be exactly the hash you were given.",
    status_lock: () => `status_echo must be exactly "${c.final_decision.status}".`,
    citation_membership: (r) => `Cite only source_ids that appear in evidence_bundle; these do not exist: ${list(d(r, "unknown_ids"))}.`,
    uncited_claim: () => "Every fact, code and finding sentence must cite at least one source_id from evidence_bundle.",
    numeric_alignment: (r) => `These numbers are not in the contract's facts or in the excerpts the sentence cites: ${list(d(r, "numbers"))}. Copy numbers exactly; never compute, convert or compare them.`,
    action_allowlist: () => `Use only these action ids: ${c.allowed_next_actions.join(", ")}.`,
    banned_phrases: (r) => `Do not use these phrases to describe an outcome: ${list(d(r, "phrases"))}.`,
    finding_coverage: (r) => `Give an entry for every fail finding (${list(d(r, "uncovered_fails")) || "none missing"}) and use only the contract's finding ids (not: ${list(d(r, "unknown_finding_ids")) || "none"}).`,
    abstention: () => "The status is insufficient_evidence: write no sentence of kind finding, and suggest only collect_missing_information or contact_city.",
    unknown_as_pass: () => `Never say that a category in unknown_or_unsupported_categories (${c.unknown_or_unsupported_categories.join(", ")}) passed or meets a standard; say it was not checked.`,
  };
  return runs.filter((r) => r.result === "fail").map((r) => notes[r.validator]?.(r) ?? `${r.validator} failed.`);
}

const parseRaw = (raw: unknown): unknown => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
};

export async function writeValidatedBrief(i: {
  contract: BriefingContract; contractHash: string;
  write: (repair?: string[]) => Promise<BriefingCall>; // one model call, with or without repair notes
  maxRepairs?: number;
}): Promise<ValidatedBrief> {
  const attempts: BriefAttempt[] = [];
  let repair: string[] | undefined;
  for (let n = 0; n <= (i.maxRepairs ?? 1); n++) {
    const call = await i.write(repair);
    // An answer that came back but did not parse is still an answer: the schema validator records it and a repair
    // may follow. No answer at all (API error, timeout) is not validated or repaired.
    const answer = call.status === "ok" ? call.output : parseRaw(call.raw);
    const validation = answer === undefined ? null : validateBrief(i.contract, i.contractHash, answer);
    attempts.push({ call, validation });
    if (!validation || validation.outcome === "validated") break;
    repair = repairNotes(i.contract, validation.runs);
  }
  const final = attempts.at(-1)!;
  return { attempts, final, outcome: final.validation?.outcome === "validated" ? "validated" : "fallback" };
}
