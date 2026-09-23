import { z } from "zod";
import { BriefingOutput, type BriefingContract } from "@parcelpilot/contracts";
import type { BriefingCall } from "./briefing-client.ts";

// Non-Claude briefing candidates through OpenRouter (MOO-837 evaluation; Tarik, 2026-09-22). Same prompt, same contract,
// same schema and the same result shape as the Claude path, so the eval scores every model identically. Requests are
// routed only to providers that support strict structured outputs, never train on the data, and keep zero data
// retention unless the caller opts one model out (allowRetention).

// USD per million tokens, from openrouter.ai/api/v1/models on 2026-09-22.
export const OPENROUTER_PRICES: Record<string, { input: number; output: number }> = {
  "openai/gpt-6-luna": { input: 0.1, output: 0.5 },
  "google/gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "openai/gpt-6-sol": { input: 2, output: 10 }, // launched 2026-09-22; OpenAI-hosted, no zero-retention endpoint
};

// Strict mode (OpenAI-style) needs every property listed as required and no unsupported keywords. An optional property
// is sent as required-but-nullable; the nulls are removed before the zod parse, which also re-checks maxLength.
type Json = Record<string, unknown>;
function strictSchema(s: Json): Json {
  if (Array.isArray(s["anyOf"])) return { ...s, anyOf: (s["anyOf"] as Json[]).map(strictSchema) };
  if (s["type"] === "array" && s["items"]) return { ...s, items: strictSchema(s["items"] as Json) };
  if (s["type"] !== "object" || !s["properties"]) { const { maxLength: _m, minLength: _n, $schema: _s, ...rest } = s; return rest; }
  const props = s["properties"] as Record<string, Json>;
  const required = new Set((s["required"] as string[] | undefined) ?? []);
  const { $schema: _s, ...rest } = s;
  return {
    ...rest, additionalProperties: false, required: Object.keys(props),
    properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, required.has(k) ? strictSchema(v) : { anyOf: [strictSchema(v), { type: "null" }] }])),
  };
}
const dropNulls = (v: unknown): unknown => Array.isArray(v) ? v.map(dropNulls)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) : v;
export const BRIEFING_OUTPUT_STRICT_SCHEMA = strictSchema(z.toJSONSchema(BriefingOutput) as Json);

export async function writeBriefOpenRouter(i: {
  contract: BriefingContract; contractHash: string; system: string; model: string;
  apiKey?: string | undefined; timeoutMs?: number; fetchImpl?: typeof fetch;
  // Zero data retention is required unless a caller opts out for one named model (eval only; Tarik, 2026-09-22 for
  // GPT-6 Luna, whose endpoints are all OpenAI-hosted without ZDR). Training on the data is refused either way.
  allowRetention?: boolean;
}): Promise<BriefingCall> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const failed = (error: string, raw: string | null = null, model: string | null = null, usage: { input_tokens: number; output_tokens: number } | null = null): BriefingCall =>
    ({ status: "failed", error: error.slice(0, 500), raw, model, usage, latencyMs: elapsed(), costUsd: usage ? cost(i.model, usage) : null });
  const price = OPENROUTER_PRICES[i.model];
  if (!price) return failed(`OpenRouter model ${i.model} is not one of ${Object.keys(OPENROUTER_PRICES).join(", ")}`);
  if (!i.apiKey) return failed("OPENROUTER_API_KEY not set");
  let res: Response;
  try {
    res = await (i.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${i.apiKey}` },
      signal: AbortSignal.timeout(i.timeoutMs ?? 180_000),
      body: JSON.stringify({
        model: i.model,
        messages: [{ role: "system", content: i.system }, { role: "user", content: `contract_hash: ${i.contractHash}\n\ncontract:\n${JSON.stringify(i.contract)}` }],
        response_format: { type: "json_schema", json_schema: { name: "briefing_output_v1", strict: true, schema: BRIEFING_OUTPUT_STRICT_SCHEMA } },
        max_tokens: 16000,
        provider: { require_parameters: true, data_collection: "deny", ...(i.allowRetention ? {} : { zdr: true }) },
      }),
    });
  } catch (e) {
    return failed(`OpenRouter request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) return failed(`OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`, text);
  let body: { model?: string; choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  try { body = JSON.parse(text); } catch { return failed("OpenRouter response is not JSON", text); }
  const usage = { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 };
  const choice = body.choices?.[0];
  const content = choice?.message?.content ?? "";
  const model = body.model ?? null;
  if (choice?.finish_reason === "length") return failed("max_tokens: output cut off", content, model, usage);
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return failed("no parseable output", content, model, usage); }
  const out = BriefingOutput.safeParse(dropNulls(parsed));
  if (!out.success) return failed(`schema-invalid output: ${out.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`, content, model, usage);
  return { status: "ok", output: out.data, raw: content, model: model ?? i.model, usage, latencyMs: elapsed(), costUsd: cost(i.model, usage) ?? 0 };
}

function cost(model: string, u: { input_tokens: number; output_tokens: number }): number | null {
  const p = OPENROUTER_PRICES[model];
  return p ? (u.input_tokens * p.input + u.output_tokens * p.output) / 1_000_000 : null;
}
