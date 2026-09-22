import { JEV_QUESTIONS_V1, JevResponse, type DecisionPolicy, type PreparedState } from "@parcelpilot/contracts";

// JEV client (MOO-836; 05 §4.5, §4.8; docs.typesafe.ai/api read 2026-09-22). Server-side only. One request carries all
// four questions. The whole call, retries included, gets one time budget from the decision policy; past it, or on any
// HTTP error or schema-invalid answer, the call is `failed` and the run keeps its rules-only result.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000; // docs.typesafe.ai/models, jev-1.13.0; output tokens are free
const MAX_TRIES = 3;

export type JevCall =
  | { status: "ok"; response: JevResponse; raw: unknown; latencyMs: number; costUsd: number }
  | { status: "failed"; error: string; raw: unknown; latencyMs: number };

export async function askJev(state: PreparedState, opts: { apiKey: string | undefined; timeoutMs: number; model?: string; fetchImpl?: typeof fetch }): Promise<JevCall> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const failed = (error: string, raw: unknown = null): JevCall => ({ status: "failed", error, raw, latencyMs: elapsed() });
  if (!opts.apiKey) return failed("TYPESAFE_API_KEY not set");
  const body = JSON.stringify({ model: opts.model ?? "jev-latest", state, questions: JEV_QUESTIONS_V1 });
  for (let attempt = 1; ; attempt++) {
    const remaining = opts.timeoutMs - elapsed();
    if (remaining <= 0) return failed(`timeout after ${opts.timeoutMs} ms`);
    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` }, body, signal: AbortSignal.timeout(remaining),
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
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return failed("response is not JSON", text.slice(0, 300)); }
    const parsed = JevResponse.safeParse(raw);
    if (!parsed.success) return failed(`schema-invalid response: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`, raw);
    return { status: "ok", response: parsed.data, raw, latencyMs: elapsed(), costUsd: parsed.data.usage.input_tokens * PRICE_PER_INPUT_TOKEN_USD };
  }
}

// overall_risk is a Score on 0–2; bucket it with the policy's cut points, never interpolate (05 §4.6).
export function riskBucket(score: number, t: DecisionPolicy["thresholds"]): "low" | "medium" | "high" {
  return score >= t.risk_high_at ? "high" : score >= t.risk_medium_at ? "medium" : "low";
}
