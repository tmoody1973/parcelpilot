import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BriefingOutput, type BriefingContract } from "@parcelpilot/contracts";

// The briefing model call (MOO-837; 05 §6). Server-side only; ANTHROPIC_API_KEY from the environment. Structured output
// against briefing_output.v1. No tools, no web, no retrieval. The model's internal reasoning is never stored: only the
// JSON text is kept. Both candidate models reject sampling parameters, so there is no temperature to set (05 §6 said 0);
// `effort` is the one knob. Anything other than a complete, schema-valid answer is `failed` → templated brief.

export const BRIEFING_PROMPT_VERSION = "briefing.v2"; // v1 set two rules against each other on insufficient evidence
// Decision 014 (Tarik, 2026-09-22): Opus 5.5 at effort medium writes briefs by default; GPT-6 Luna is the evaluated backup.
export const DEFAULT_BRIEFING_MODEL = "claude-opus-5-5";
export const DEFAULT_BRIEFING_EFFORT = "medium" as const;
export const BRIEFING_SCHEMA_VERSION = "briefing_output.v1";
// USD per million tokens (claude-api skill model table, cached 2026-06-24). Thinking is billed as output.
export const BRIEFING_PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 }, // launched 2026-09-22; thinking always on, effort defaults to medium
};
export const BRIEFING_MODELS = Object.keys(BRIEFING_PRICES);

export type BriefingUsage = { input_tokens: number; output_tokens: number };
export type BriefingCall =
  | { status: "ok"; output: BriefingOutput; raw: string; model: string; usage: BriefingUsage; latencyMs: number; costUsd: number }
  | { status: "failed"; error: string; raw: string | null; model: string | null; usage: BriefingUsage | null; latencyMs: number; costUsd: number | null };

const cost = (model: string, u: BriefingUsage) => {
  const p = BRIEFING_PRICES[model];
  return p ? (u.input_tokens * p.input + u.output_tokens * p.output) / 1_000_000 : null;
};

export async function writeBrief(i: {
  contract: BriefingContract; contractHash: string; system: string; model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; timeoutMs?: number; client?: Anthropic;
}): Promise<BriefingCall> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!BRIEFING_PRICES[i.model]) return { status: "failed", error: `briefing model ${i.model} is not one of ${BRIEFING_MODELS.join(", ")}`, raw: null, model: null, usage: null, latencyMs: 0, costUsd: null };
  const client = i.client ?? new Anthropic();
  try {
    const response = await client.messages.parse({
      model: i.model,
      max_tokens: 16000,
      system: i.system,
      messages: [{ role: "user", content: `contract_hash: ${i.contractHash}\n\ncontract:\n${JSON.stringify(i.contract)}` }],
      output_config: { format: zodOutputFormat(BriefingOutput), ...(i.effort ? { effort: i.effort } : {}) },
    }, { timeout: i.timeoutMs ?? 120_000 });
    const raw = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    const base = { raw, model: response.model, usage, latencyMs: elapsed(), costUsd: cost(i.model, usage) };
    if (response.stop_reason === "refusal") return { status: "failed", error: `refusal${response.stop_details?.category ? `:${response.stop_details.category}` : ""}`, ...base };
    if (response.stop_reason === "max_tokens") return { status: "failed", error: "max_tokens: output cut off", ...base };
    if (!response.parsed_output) return { status: "failed", error: "no parseable output", ...base };
    return { status: "ok", output: response.parsed_output, ...base, costUsd: base.costUsd ?? 0 };
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `API ${e.status ?? "error"}: ${e.message}` : `briefing call failed: ${e instanceof Error ? e.message : String(e)}`;
    return { status: "failed", error: error.slice(0, 500), raw: null, model: null, usage: null, latencyMs: elapsed(), costUsd: null };
  }
}
