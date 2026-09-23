import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { JEV_QUESTIONS_V1, JevResponse, JevRoute, type DecisionPolicy, type PreparedState } from "@parcelpilot/contracts";
import { BATCH_DISCOUNT, type BatchedMessage, type BatchParams } from "./briefing-batch.ts";
import { briefingCallFrom, type BriefingUsage } from "./briefing-client.ts";

// JEV client (MOO-836; 05 §4.5, §4.8; docs.typesafe.ai/api read 2026-09-22). Server-side only. One request carries all
// four questions. The whole call, retries included, gets one time budget from the decision policy; past it, or on any
// HTTP error or schema-invalid answer, the call is `failed` and the run keeps its rules-only result.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000; // docs.typesafe.ai/models, jev-1.13.0; output tokens are free
const MAX_TRIES = 3;

export type JevCall =
  | { status: "ok"; response: JevResponse; raw: unknown; latencyMs: number; costUsd: number }
  | { status: "failed"; error: string; raw: unknown; latencyMs: number };

// One POST to the System One endpoint inside a single time budget, retrying 429/529 with backoff. Shared by the
// decision questions (askJev) and the citation-support check (citation-support.ts). Parsing is the caller's.
export type SystemOneCall = { status: "ok"; raw: unknown; latencyMs: number } | { status: "failed"; error: string; raw: unknown; latencyMs: number };
export async function postSystemOne(body: unknown, opts: { apiKey: string | undefined; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<SystemOneCall> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const failed = (error: string, raw: unknown = null): SystemOneCall => ({ status: "failed", error, raw, latencyMs: elapsed() });
  if (!opts.apiKey) return failed("TYPESAFE_API_KEY not set");
  const payload = JSON.stringify(body);
  for (let attempt = 1; ; attempt++) {
    const remaining = opts.timeoutMs - elapsed();
    if (remaining <= 0) return failed(`timeout after ${opts.timeoutMs} ms`);
    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` }, body: payload, signal: AbortSignal.timeout(remaining),
      });
    } catch (e) {
      const name = (e as { name?: string }).name;
      return failed(name === "TimeoutError" || name === "AbortError" ? `timeout after ${opts.timeoutMs} ms` : `network error: ${(e as Error).message}`);
    }
    if ((res.status === 429 || res.status === 529) && attempt < MAX_TRIES) {
      await new Promise((r) => setTimeout(r, Math.min(100 * 2 ** (attempt - 1), Math.max(0, opts.timeoutMs - elapsed()))));
      continue;
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) return failed(`HTTP ${res.status}: ${text.slice(0, 300)}`, { http_status: res.status, body: text.slice(0, 4000) }); // logged in raw_response
    try { return { status: "ok", raw: JSON.parse(text), latencyMs: elapsed() }; } catch { return failed("response is not JSON", text.slice(0, 300)); }
  }
}

export const systemOneCost = (inputTokens: number) => inputTokens * PRICE_PER_INPUT_TOKEN_USD;

export async function askJev(state: PreparedState, opts: { apiKey: string | undefined; timeoutMs: number; model?: string; fetchImpl?: typeof fetch }): Promise<JevCall> {
  const call = await postSystemOne({ model: opts.model ?? "jev-latest", state, questions: JEV_QUESTIONS_V1 }, opts);
  if (call.status === "failed") return call;
  const parsed = JevResponse.safeParse(call.raw);
  if (!parsed.success) return { status: "failed", error: `schema-invalid response: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`, raw: call.raw, latencyMs: call.latencyMs };
  return { status: "ok", response: parsed.data, raw: call.raw, latencyMs: call.latencyMs, costUsd: systemOneCost(parsed.data.usage.input_tokens) };
}

// Comparator 2 (MOO-844; 05 §4.2, PRD §9.3): a conventional LLM with structured output answers the same four questions
// from the same prepared state, through the Message Batches API. Evaluation only: servableDecisionMode refuses this mode
// for a live run, and jev_runs refuses a baseline row that claims policy use. Logged like JEV, with provider = baseline.
export const BASELINE_MODEL = "claude-sonnet-5"; // Tarik's call for M6 (09 §M6)
export const BASELINE_PROMPT_VERSION = "baseline.v1";
const BASELINE_SYSTEM = [
  "You answer four questions about a preliminary zoning-screen state for a Milwaukee infill parcel.",
  "The user message holds the state and the questions. Each question has instructions and criteria; follow them, and use only the supplied state.",
  "overall_risk.score is a number from 0 (Low) to 2 (High). A noul is the degree, from 0 to 1, to which the statement is true.",
  "recommended_route.choice is one of the route keys in the question's criteria. Each confidence is your confidence, from 0 to 1, in that answer.",
].join("\n");
const Unit = z.number().min(0).max(1);
export const BaselineAnswers = z.object({
  overall_risk: z.object({ score: z.number().min(0).max(2), confidence: Unit }).strict(),
  manual_review_required: z.object({ noul: Unit }).strict(),
  recommended_route: z.object({ choice: JevRoute, confidence: Unit }).strict(),
  summary_safe_to_display: z.object({ noul: Unit }).strict(),
}).strict();
export type BaselineAnswers = z.infer<typeof BaselineAnswers>;
export type BaselineCall =
  | { status: "ok"; response: { model: string; answers: BaselineAnswers; usage: BriefingUsage }; raw: unknown; latencyMs: number; costUsd: number }
  | { status: "failed"; error: string; raw: unknown; latencyMs: number };

export function baselineParams(state: PreparedState, model = BASELINE_MODEL) {
  const { parse, ...format } = zodOutputFormat(BaselineAnswers);
  const params: BatchParams = {
    model, max_tokens: 8000, system: BASELINE_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ state, questions: JEV_QUESTIONS_V1 }) }],
    output_config: { format },
  };
  return { params, parse };
}

export async function askBaseline(state: PreparedState, opts: { send: (params: BatchParams) => Promise<BatchedMessage>; model?: string }): Promise<BaselineCall> {
  const model = opts.model ?? BASELINE_MODEL;
  const { params, parse } = baselineParams(state, model);
  const sent = await opts.send(params);
  if (sent.status === "failed") return { status: "failed", error: sent.error, raw: null, latencyMs: sent.latencyMs };
  const call = briefingCallFrom(sent.message, parse, model, sent.latencyMs, BATCH_DISCOUNT);
  if (call.status === "failed") return { status: "failed", error: call.error, raw: sent.message, latencyMs: call.latencyMs };
  return { status: "ok", response: { model: call.model, answers: call.output as unknown as BaselineAnswers, usage: call.usage }, raw: sent.message, latencyMs: call.latencyMs, costUsd: call.costUsd };
}

// overall_risk is a Score on 0–2; bucket it with the policy's cut points, never interpolate (05 §4.6).
export function riskBucket(score: number, t: DecisionPolicy["thresholds"]): "low" | "medium" | "high" {
  return score >= t.risk_high_at ? "high" : score >= t.risk_medium_at ? "medium" : "low";
}
