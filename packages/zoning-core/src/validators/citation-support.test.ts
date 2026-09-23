import { test } from "node:test";
import assert from "node:assert/strict";
import type { BriefingOutput } from "@parcelpilot/contracts";
import { validateBrief } from "./brief.ts";
import { S, contract, hash, valid } from "./brief.fixture.ts";
import { CITATION_SUPPORT_MODEL, checkCitationSupport, citationSupportEnabled, supportPairs, supportRequest } from "./citation-support.ts";

// A stand-in TypeSafe endpoint: it reads each question's claim and section back out of the request, as JEV would, and
// answers with `judge`. It also counts requests.
type Verdict = { choice: "supports" | "contradicts" | "says_nothing"; confidence: number };
function fakeJev(judge: (claim: string, section: string) => Verdict) {
  const calls: unknown[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { model: string; state: { claims: string[]; sections: string[] }; questions: Record<string, { instructions: string }> };
    calls.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      const [, si, ci] = q.instructions.match(/`sections\[(\d+)\]`.*`claims\[(\d+)\]`/)!;
      const v = judge(body.state.claims[Number(ci)]!, body.state.sections[Number(si)]!);
      return [id, { type: "choice", ...v, probabilities: { [v.choice]: v.confidence } }];
    }));
    return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1000, output_tokens: 0 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const supportsAll = () => ({ choice: "supports", confidence: 0.95 }) as const;
const PLANTED = "Table 295-605-2 sets a minimum front setback for LB1.";
// The planted claim cites the height row, which says nothing about front setbacks. It has no number, so the eleven
// deterministic checks all let it through: only the citation-support check can catch it.
const planted = (): BriefingOutput => ({ ...valid(), executive_summary: [...valid().executive_summary, S(PLANTED, "code", ["fam-1@1"])] });
const check = (brief: BriefingOutput, judge: (claim: string, section: string) => Verdict) => {
  const jev = fakeJev(judge);
  return checkCitationSupport(contract, hash, validateBrief(contract, hash, brief), { apiKey: "k", fetchImpl: jev.fetchImpl }).then((v) => ({ v, calls: jev.calls }));
};
const supportRun = (v: Awaited<ReturnType<typeof check>>["v"]) => v.runs.find((r) => r.validator === "citation_support")!;

test("the flag is off unless CITATION_SUPPORT_CHECK is exactly 'true'", () => {
  assert.equal(citationSupportEnabled({}), false);
  assert.equal(citationSupportEnabled({ CITATION_SUPPORT_CHECK: "1" }), false);
  assert.equal(citationSupportEnabled({ CITATION_SUPPORT_CHECK: "true" }), true);
});

test("one request per brief, pinned model, one question per (checked sentence, excerpt) pair", () => {
  const pairs = supportPairs(contract, validateBrief(contract, hash, planted()));
  // checked kinds only: fact/code/finding (framing and advice are not asked about)
  assert.deepEqual(pairs.map((p) => p.sentence_id), ["executive_summary[2]", "status_explanation[0]", "verified_findings[0].sentences[0]", "verified_findings[1].sentences[0]"]);
  const req = supportRequest(pairs);
  assert.equal(req.model, CITATION_SUPPORT_MODEL);
  assert.equal(Object.keys(req.questions).length, 4);
  assert.equal(req.state.sections.length, 2, "each excerpt is sent once");
});

test("planted: a claim cited to a row that says nothing about it is removed (confident, no review)", async () => {
  const { v, calls } = await check(planted(), (claim) => (claim === PLANTED ? { choice: "says_nothing", confidence: 0.95 } : supportsAll()));
  assert.equal(calls.length, 1);
  assert.equal(v.outcome, "validated");
  assert.ok(!v.brief!.executive_summary.some((s) => s.text === PLANTED));
  const r = supportRun(v);
  assert.deepEqual([r.result, r.effect, r.removed_sentence_ids], ["fail", "sentence_removed", ["executive_summary[2]"]]);
  assert.deepEqual(r.detail["review_sentence_ids"], []);
  assert.equal((r.detail["pairs"] as unknown[]).length, 4, "per-pair answers are logged");
});

test("below 0.8 the sentence is still removed, and sampled for review", async () => {
  const { v } = await check(planted(), (claim) => (claim === PLANTED ? { choice: "contradicts", confidence: 0.6 } : supportsAll()));
  assert.equal(v.outcome, "validated");
  assert.deepEqual(supportRun(v).detail["review_sentence_ids"], ["executive_summary[2]"]);
});

test("a finding sentence that is not supported fails the whole brief to the template", async () => {
  const { v } = await check(valid(), (claim) => (claim.includes("46 ft") ? { choice: "contradicts", confidence: 0.9 } : supportsAll()));
  assert.equal(v.outcome, "fallback");
  assert.equal(v.brief, null);
  assert.deepEqual([supportRun(v).effect, supportRun(v).detail["finding_removed"]], ["brief_failed", true]);
});

test("a sentence resting on two excerpts stays if either supports it", async () => {
  const two = { ...valid(), status_explanation: [S("The height finding failed; the other reviewed category passed.", "finding", ["fam-1@1", "fam-2@1"])] };
  const { v } = await check(two, (claim, section) => (claim.startsWith("The height finding") && section.includes("Multi-family") ? { choice: "says_nothing", confidence: 0.9 } : supportsAll()));
  assert.equal(v.outcome, "validated");
  assert.deepEqual(supportRun(v).removed_sentence_ids, []);
});

test("JEV unavailable or too slow: the check is skipped and the brief falls back to the template", async () => {
  const down = (async () => new Response("busy", { status: 503 })) as unknown as typeof fetch;
  const v = await checkCitationSupport(contract, hash, validateBrief(contract, hash, valid()), { apiKey: "k", fetchImpl: down });
  assert.equal(v.outcome, "fallback");
  assert.deepEqual([supportRun({ ...v } as never).result, supportRun({ ...v } as never).effect], ["skipped", "brief_failed"]);
  const noKey = await checkCitationSupport(contract, hash, validateBrief(contract, hash, valid()), { apiKey: undefined });
  assert.equal(noKey.outcome, "fallback");
});

test("a brief the eleven already failed is not sent to JEV", async () => {
  const { v, calls } = await check({ ...valid(), status_echo: "proceed_to_concept_design" }, supportsAll);
  assert.equal(calls.length, 0);
  assert.equal(v.runs.some((r) => r.validator === "citation_support"), false);
});
