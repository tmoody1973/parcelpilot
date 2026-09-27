import Anthropic from "@anthropic-ai/sdk";
import { BRIEFING_PRICES, briefingCallFrom, briefingParams, type BriefRequest, type BriefingCall } from "./briefing-client.ts";

// Messages through the Message Batches API: half the price, answers in minutes to hours instead of seconds. For
// evaluations only, never a live run. Every pending request joins one batch, sent once no new request has arrived for
// `idleMs`. `approve(n, maxUsd)` sees each batch's worst case (every request writes max_tokens) before it is sent, and
// may throw. The briefs (briefingBatcher) and the structured-output baseline (askBaseline) both go through here.

export const BATCH_DISCOUNT = 0.5;
export type BatchParams = Anthropic.MessageCreateParamsNonStreaming & { system: string; messages: { role: "user"; content: string }[] };
export type BatchedMessage = { status: "ok"; message: Anthropic.Message; latencyMs: number } | { status: "failed"; error: string; latencyMs: number };
export type MessageBatcherOptions = { client?: Anthropic; idleMs?: number; pollMs?: number; approve?: (requests: number, maxUsd: number) => void; log?: (m: string) => void };

type Pending = { params: BatchParams; resolve: (m: BatchedMessage) => void };

export function messageBatcher(o: MessageBatcherOptions = {}) {
  const client = o.client ?? new Anthropic();
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function send(batch: Pending[]) {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const failed = (p: Pending, error: string) => p.resolve({ status: "failed", error: error.slice(0, 500), latencyMs: elapsed() });
    try {
      o.approve?.(batch.length, batch.reduce((sum, p) => sum + worstCase(p.params), 0));
      const created = await client.messages.batches.create({ requests: batch.map((p, i) => ({ custom_id: `r${i}`, params: p.params })) });
      o.log?.(`batch ${created.id}: ${batch.length} request(s) sent`);
      let status = created;
      while (status.processing_status !== "ended") {
        await new Promise((r) => setTimeout(r, o.pollMs ?? 30_000));
        status = await client.messages.batches.retrieve(created.id);
        o.log?.(`batch ${created.id}: ${status.request_counts.processing} processing, ${status.request_counts.succeeded} done, ${status.request_counts.errored} errored`);
      }
      const latencyMs = elapsed();
      const done = new Set<number>();
      for await (const r of await client.messages.batches.results(created.id)) {
        const i = Number(r.custom_id.slice(1));
        const p = batch[i];
        if (!p || done.has(i)) continue;
        done.add(i);
        p.resolve(r.result.type === "succeeded"
          ? { status: "ok", message: r.result.message, latencyMs }
          : { status: "failed", error: `batch ${r.result.type}${r.result.type === "errored" ? `: ${r.result.error.error.type}` : ""}`, latencyMs });
      }
      batch.forEach((p, i) => { if (!done.has(i)) failed(p, "batch: no result returned"); });
    } catch (e) {
      batch.forEach((p) => failed(p, `batch failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  return {
    send(params: BatchParams): Promise<BatchedMessage> {
      if (!BRIEFING_PRICES[params.model]) return Promise.resolve({ status: "failed", error: `batch: ${params.model} is not a priced Claude model`, latencyMs: 0 });
      return new Promise((resolve) => {
        queue.push({ params, resolve });
        clearTimeout(timer);
        timer = setTimeout(() => { const batch = queue; queue = []; void send(batch); }, o.idleMs ?? 1000);
      });
    },
  };
}

// `write` has the same shape as writeBrief, so writeValidatedBrief runs unchanged; repairs form the next batch.
export function briefingBatcher(o: MessageBatcherOptions = {}) {
  const batcher = messageBatcher(o);
  return {
    async write(req: BriefRequest): Promise<BriefingCall> {
      const { params, parse } = briefingParams(req);
      const r = await batcher.send(params);
      return r.status === "ok"
        ? briefingCallFrom(r.message, parse, req.model, r.latencyMs, BATCH_DISCOUNT)
        : { status: "failed", error: r.error, raw: null, model: null, usage: null, latencyMs: r.latencyMs, costUsd: null };
    },
  };
}

// Upper bound for one request at batch price: its input (~4 characters a token) plus the full max_tokens as output.
function worstCase(params: BatchParams): number {
  const p = BRIEFING_PRICES[params.model]!;
  const inputTokens = (params.system.length + params.messages.reduce((n, m) => n + m.content.length, 0)) / 4;
  return BATCH_DISCOUNT * (inputTokens * p.input + params.max_tokens * p.output) / 1_000_000;
}
