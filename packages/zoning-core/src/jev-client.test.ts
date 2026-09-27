import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { JEV_QUESTIONS_V1, type PreparedState } from "@parcelpilot/contracts";
import { askBaseline, askJev } from "./jev-client.ts";
import type { BatchedMessage, BatchParams } from "./briefing-batch.ts";
import { servableDecisionMode, resolveDecisionMode } from "./decision-mode.ts";

const state = { version: "prepared_state.v1" } as unknown as PreparedState; // the client never inspects the state
const good = {
  model: "jev-1.13.0",
  answers: {
    overall_risk: { type: "score", score: 1.7, legend: { "0": "Low", "1": "Medium", "2": "High" }, probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 }, confidence: 0.8 },
    manual_review_required: { type: "noul", noul: 0.9 },
    recommended_route: { type: "choice", choice: "revise_scenario", probabilities: { revise_scenario: 0.8, engage_zoning_professional: 0.2 }, confidence: 0.75 },
    summary_safe_to_display: { type: "noul", noul: 0.8 },
  },
  usage: { input_tokens: 2000, output_tokens: 40 },
};
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
function stub(...responses: Array<Response | ((signal: AbortSignal) => Promise<Response>)>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>)["authorization"]! });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return typeof next === "function" ? next(init.signal!) : next.clone();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
// Resolves after `ms` unless the request is aborted first, like a real slow server.
const slow = (ms: number) => (signal: AbortSignal) => new Promise<Response>((resolve, reject) => {
  const t = setTimeout(() => resolve(reply(200, good)), ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); });
});

test("one request carries the four v1 questions and the state; the answer is parsed and priced", async () => {
  const s = stub(reply(200, good));
  const r = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: s.fetchImpl });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0]!.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(s.calls[0]!.auth, "Bearer k");
  assert.deepEqual(s.calls[0]!.body, { model: "jev-latest", state, questions: JSON.parse(JSON.stringify(JEV_QUESTIONS_V1)) });
  assert.equal(r.status, "ok");
  if (r.status === "ok") {
    assert.equal(r.response.model, "jev-1.13.0");
    assert.equal(r.response.answers.recommended_route.choice, "revise_scenario");
    assert.ok(Math.abs(r.costUsd - 2000 * 0.042e-6) < 1e-12);
  }
});

test("a response slower than the budget fails at the budget, not when the server answers", async () => {
  const s = stub(slow(3000));
  const t0 = performance.now();
  const r = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: s.fetchImpl });
  const took = performance.now() - t0;
  assert.equal(r.status, "failed");
  if (r.status === "failed") assert.match(r.error, /timeout after 2000 ms/);
  assert.ok(took >= 1900 && took < 2600, `gave up after ${Math.round(took)} ms`);
});

test("429 and 529 are retried within the budget; other errors are not", async () => {
  const retried = stub(reply(529, "overloaded"), reply(429, "slow down"), reply(200, good));
  assert.equal((await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: retried.fetchImpl })).status, "ok");
  assert.equal(retried.calls.length, 3);
  const exhausted = stub(reply(429, "slow down"));
  const r = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: exhausted.fetchImpl });
  assert.deepEqual([r.status, exhausted.calls.length], ["failed", 3]);
  const invalid = stub(reply(422, { detail: "questions.overall_risk.criteria: too few levels" }));
  const v = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: invalid.fetchImpl });
  assert.deepEqual([v.status, invalid.calls.length], ["failed", 1]);
  if (v.status === "failed") { assert.match(v.error, /HTTP 422/); assert.deepEqual(v.raw, { http_status: 422, body: JSON.stringify({ detail: "questions.overall_risk.criteria: too few levels" }) }, "the error body is kept for the log"); }
});

test("a field the vendor adds later does not fail the call", async () => {
  const r = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: stub(reply(200, { ...good, request_id: "req_1", answers: { ...good.answers, recommended_route: { ...good.answers.recommended_route, rationale_tokens: 3 } } })).fetchImpl });
  assert.equal(r.status, "ok");
});

test("a schema-invalid answer, a non-JSON body or a missing key is a failed call, with the raw answer kept", async () => {
  const bad = stub(reply(200, { ...good, answers: { ...good.answers, recommended_route: { type: "choice", choice: "build_it", probabilities: {}, confidence: 1 } } }));
  const r = await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: bad.fetchImpl });
  assert.equal(r.status, "failed");
  if (r.status === "failed") { assert.match(r.error, /schema-invalid.*recommended_route/); assert.ok(r.raw, "the raw response is kept for the log"); }
  assert.equal((await askJev(state, { apiKey: "k", timeoutMs: 2000, fetchImpl: stub(reply(200, "<html>")).fetchImpl })).status, "failed");
  const noKey = stub(reply(200, good));
  assert.equal((await askJev(state, { apiKey: undefined, timeoutMs: 2000, fetchImpl: noKey.fetchImpl })).status, "failed");
  assert.equal(noKey.calls.length, 0, "no request is sent without a key");
});

test("only rules_only and shadow can serve a run; jev and the baseline are refused", async () => {
  assert.equal(servableDecisionMode(await resolveDecisionMode({ env: {} })), "rules_only");
  assert.equal(servableDecisionMode(await resolveDecisionMode({ env: { DECISION_MODE: "shadow" } })), "shadow");
  await assert.rejects(async () => servableDecisionMode(await resolveDecisionMode({ env: { DECISION_MODE: "jev" } })), /M6 gates/);
  await assert.rejects(async () => servableDecisionMode(await resolveDecisionMode({ env: { DECISION_MODE: "structured_output_baseline" } })), /never serves users/);
});

const baselineAnswers = { overall_risk: { score: 1.6, confidence: 0.7 }, manual_review_required: { noul: 0.9 }, recommended_route: { choice: "revise_scenario", confidence: 0.65 }, summary_safe_to_display: { noul: 0.8 } };
const claudeMessage = (text: string, stop_reason = "end_turn") => ({ model: "claude-sonnet-5", stop_reason, stop_details: null, usage: { input_tokens: 3000, output_tokens: 500 }, content: [{ type: "text", text }] }) as unknown as Anthropic.Message;
function sender(result: BatchedMessage) {
  const sent: BatchParams[] = [];
  return { sent, send: async (p: BatchParams) => { sent.push(p); return result; } };
}

test("the baseline asks Sonnet 5 the same four questions about the same state, parsed and priced at batch price", async () => {
  const s = sender({ status: "ok", message: claudeMessage(JSON.stringify(baselineAnswers)), latencyMs: 60_000 });
  const r = await askBaseline(state, { send: s.send });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.model, "claude-sonnet-5");
  assert.deepEqual(JSON.parse(s.sent[0]!.messages[0]!.content), { state, questions: JSON.parse(JSON.stringify(JEV_QUESTIONS_V1)) });
  assert.equal(r.status, "ok");
  if (r.status === "ok") {
    assert.equal(r.response.model, "claude-sonnet-5");
    assert.deepEqual(r.response.answers, baselineAnswers);
    assert.ok(Math.abs(r.costUsd - 0.5 * (3000 * 2 + 500 * 10) / 1_000_000) < 1e-12);
    assert.equal(r.latencyMs, 60_000);
  }
});

test("a baseline answer off the schema, cut off, or never returned is a failed call", async () => {
  const offSchema = await askBaseline(state, { send: sender({ status: "ok", message: claudeMessage(JSON.stringify({ ...baselineAnswers, recommended_route: { choice: "build_it", confidence: 1 } })), latencyMs: 5 }).send });
  assert.equal(offSchema.status, "failed");
  if (offSchema.status === "failed") { assert.match(offSchema.error, /no parseable output/); assert.ok(offSchema.raw, "the raw message is kept for the log"); }
  const cut = await askBaseline(state, { send: sender({ status: "ok", message: claudeMessage("{", "max_tokens"), latencyMs: 5 }).send });
  assert.match(cut.status === "failed" ? cut.error : "", /max_tokens/);
  const lost = await askBaseline(state, { send: sender({ status: "failed", error: "batch: no result returned", latencyMs: 5 }).send });
  assert.deepEqual([lost.status, lost.status === "failed" ? lost.error : "", lost.raw], ["failed", "batch: no result returned", null]);
});
