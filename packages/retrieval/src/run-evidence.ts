import { createHash } from "node:crypto";
import type postgres from "postgres";
import { EvidenceBundle } from "@parcelpilot/contracts";
import { retrieve } from "./retrieve.ts";
import { assembleBundle } from "./bundle.ts";

// Evidence for a locked feasibility run (MOO-835; 04 §7, 05 §5). The same question list feeds the web app and the
// offline `pnpm evidence:bundle` CLI, so a run's bundle can be reproduced and compared outside the app.

const DEFAULT_TOKEN_BUDGET = 6000;
export function evidenceTokenBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = env["EVIDENCE_TOKEN_BUDGET"];
  if (raw === undefined || raw === "") return DEFAULT_TOKEN_BUDGET;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`EVIDENCE_TOKEN_BUDGET must be a positive integer, got "${raw}"`);
  return n;
}

// One retrieval subquestion per category in scope, plus the district question. Wording for the first six is the M4
// labelled-set phrasing (docs/eval/bundles); categories without a template are skipped, never guessed.
const TEMPLATES: Record<string, (d: string, s: { use: string; ground_floor_use?: string | null }) => string> = {
  use: (d, s) => `Is a ${s.use === "multifamily" ? "multi-family dwelling" : s.use} allowed in ${d}, with ${s.ground_floor_use ?? "no"} on the ground floor?`,
  height: (d) => `maximum and minimum building height in ${d}`,
  setback_front: (d) => `front setback minimum and maximum in ${d}`,
  setback_side: (d) => `side setback in ${d}`,
  setback_rear: (d) => `rear setback in ${d}`,
  density: (d) => `lot area per dwelling unit in ${d}`,
  parking: (d, s) => `minimum off-street parking spaces required for a ${s.use === "multifamily" ? "multi-family dwelling" : s.use} in ${d}`,
  lot_coverage: (d) => `maximum lot coverage in ${d}`,
};
export function subquestionsFor(input: { districts: string[]; categories: readonly string[]; scenario: { use: string; ground_floor_use?: string | null } }): Array<[string | null, string]> {
  const d = input.districts.join(" / ");
  return [
    ...input.categories.filter((c) => TEMPLATES[c]).map((c): [string, string] => [c, TEMPLATES[c]!(d, input.scenario)]),
    [null, `${d} district purpose and where it applies`],
  ];
}

// JSON with object keys sorted at every depth, so a hash never depends on insertion order.
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const bundleHash = (b: EvidenceBundle) => createHash("sha256").update(canonicalJson(b)).digest("hex");

export type RunEvidenceInput = {
  runId: string; orgId: string; jurisdictionId: string; districts: string[]; overlays: string[]; analysisDate: string;
  categories: readonly string[]; scenario: { use: string; ground_floor_use?: string | null }; tokenBudget: number;
};
export type RunEvidence =
  | { status: "assembled"; bundle: EvidenceBundle; sha256: string; retrievalRunIds: string[] }
  | { status: "unavailable"; error: string };

// Retrieves, assembles and freezes the run's bundle. Must run in an org-scoped transaction (RLS): every retrieval row is
// written under the run's org. Any failure is caught inside a savepoint, so half-written retrieval rows roll back and the
// run is recorded as `unavailable` instead of failing.
export async function attachEvidence(tx: postgres.TransactionSql, i: RunEvidenceInput): Promise<RunEvidence> {
  let result: RunEvidence;
  try {
    result = await tx.savepoint(async (sp) => {
      if (!i.districts.length) throw new Error("the parcel has no base district, so retrieval has no filter");
      const retrievalRunIds: string[] = [];
      for (const [category, subquestion] of subquestionsFor(i)) {
        const r = await retrieve(sp, { jurisdictionId: i.jurisdictionId, subquestion, category, districts: i.districts, overlays: i.overlays, analysisDate: i.analysisDate, orgId: i.orgId, feasibilityRunId: i.runId });
        retrievalRunIds.push(r.run_id!);
      }
      const bundle = await assembleBundle(sp, { retrievalRunIds, tokenBudget: i.tokenBudget, analysisDate: i.analysisDate, runId: i.runId });
      return { status: "assembled" as const, bundle, sha256: bundleHash(bundle), retrievalRunIds };
    });
  } catch (e) {
    result = { status: "unavailable", error: e instanceof Error ? e.message : String(e) };
  }
  await tx`insert into run_evidence_bundles (org_id, feasibility_run_id, status, retrieval_run_ids, token_budget, bundle, bundle_sha256, error)
    values (${i.orgId}, ${i.runId}, ${result.status}, ${result.status === "assembled" ? result.retrievalRunIds : []}::uuid[], ${i.tokenBudget},
      ${result.status === "assembled" ? tx.json(result.bundle as never) : null}, ${result.status === "assembled" ? result.sha256 : null}, ${result.status === "unavailable" ? result.error : null})`;
  return result;
}
