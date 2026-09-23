import Anthropic from "@anthropic-ai/sdk";
import { BRIEFING_PRICES, briefingCallFrom, briefingParams, type BriefRequest, type BriefingCall } from "./briefing-client.ts";

// Briefs through the Message Batches API: half the price, answers in minutes to hours instead of seconds. For
// evaluations only, never a live run. `write` has the same shape as writeBrief, so writeValidatedBrief runs unchanged:
// every pending call joins one batch, sent once no new call has arrived for `idleMs`; repairs form the next batch.
// `approve(n, maxUsd)` sees each batch's worst case (every request writes max_tokens) before it is sent, and may throw.

type Pending = { req: BriefRequest; resolve: (c: BriefingCall) => void };

export function briefingBatcher(o: { client?: Anthropic; idleMs?: number; pollMs?: number; approve?: (requests: number, maxUsd: number) => void; log?: (m: string) => void } = {}) {
  const client = o.client ?? new Anthropic();
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function send(batch: Pending[]) {
    const started = performance.now();
    const built = batch.map((p) => briefingParams(p.req));
    const failAll = (error: string) => batch.forEach((p) => p.resolve({ status: "failed", error: error.slice(0, 500), raw: null, model: null, usage: null, latencyMs: Math.round(performance.now() - started), costUsd: null }));
    try {
      o.approve?.(batch.length, built.reduce((sum, b, i) => sum + worstCase(batch[i]!.req.model, b.params), 0));
      const created = await client.messages.batches.create({ requests: built.map((b, i) => ({ custom_id: `r${i}`, params: b.params })) });
      o.log?.(`batch ${created.id}: ${batch.length} request(s) sent`);
      let status = created;
      while (status.processing_status !== "ended") {
        await new Promise((r) => setTimeout(r, o.pollMs ?? 30_000));
        status = await client.messages.batches.retrieve(created.id);
        o.log?.(`batch ${created.id}: ${status.request_counts.processing} processing, ${status.request_counts.succeeded} done, ${status.request_counts.errored} errored`);
      }
      const latencyMs = Math.round(performance.now() - started);
      const done = new Set<number>();
      for await (const r of await client.messages.batches.results(created.id)) {
        const i = Number(r.custom_id.slice(1));
        const p = batch[i];
        if (!p || done.has(i)) continue;
        done.add(i);
        p.resolve(r.result.type === "succeeded"
          ? briefingCallFrom(r.result.message, built[i]!.parse, p.req.model, latencyMs, 0.5)
          : { status: "failed", error: `batch ${r.result.type}${r.result.type === "errored" ? `: ${r.result.error.error.type}` : ""}`, raw: null, model: null, usage: null, latencyMs, costUsd: null });
      }
      batch.forEach((p, i) => { if (!done.has(i)) p.resolve({ status: "failed", error: "batch: no result returned", raw: null, model: null, usage: null, latencyMs, costUsd: null }); });
    } catch (e) {
      failAll(`batch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    write(req: BriefRequest): Promise<BriefingCall> {
      if (!BRIEFING_PRICES[req.model]) return Promise.resolve({ status: "failed", error: `batch: ${req.model} is not a Claude briefing model`, raw: null, model: null, usage: null, latencyMs: 0, costUsd: null });
      return new Promise((resolve) => {
        queue.push({ req, resolve });
        clearTimeout(timer);
        timer = setTimeout(() => { const batch = queue; queue = []; void send(batch); }, o.idleMs ?? 1000);
      });
    },
  };
}

// Upper bound for one request at batch price: its input (~4 characters a token) plus the full max_tokens as output.
function worstCase(model: string, params: { max_tokens: number; system: string; messages: { content: string }[] }): number {
  const p = BRIEFING_PRICES[model]!;
  const inputTokens = (params.system.length + params.messages.reduce((n, m) => n + m.content.length, 0)) / 4;
  return 0.5 * (inputTokens * p.input + params.max_tokens * p.output) / 1_000_000;
}
