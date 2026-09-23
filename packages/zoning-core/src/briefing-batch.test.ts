import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { BriefingContract } from "@parcelpilot/contracts";
import { briefingBatcher } from "./briefing-batch.ts";

// A stand-in for the SDK's batches API. Results come back out of order; r2 gets no result at all.
function fakeClient(created: unknown[]) {
  const message = (text: string) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 10_000, output_tokens: 1_000 }, content: [{ type: "text", text }] });
  return {
    messages: {
      batches: {
        create: async (b: unknown) => { created.push(b); return { id: "b1", processing_status: "in_progress", request_counts: { processing: 3, succeeded: 0, errored: 0 } }; },
        retrieve: async () => ({ id: "b1", processing_status: "ended", request_counts: { processing: 0, succeeded: 2, errored: 1 } }),
        results: async () => (async function* () {
          yield { custom_id: "r1", result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "busy" } } } };
          yield { custom_id: "r0", result: { type: "succeeded", message: message("{}") } };
        })(),
      },
    },
  } as unknown as Anthropic;
}

const req = (n: number) => ({ contract: { n } as unknown as BriefingContract, contractHash: "h", system: "s", model: "claude-opus-5-5" });

test("calls made together go out as one batch; each caller gets its own result at half price", async () => {
  const created: unknown[] = [];
  const b = briefingBatcher({ client: fakeClient(created), idleMs: 5, pollMs: 1 });
  const [a, c, d] = await Promise.all([b.write(req(0)), b.write(req(1)), b.write(req(2))]);
  assert.equal(created.length, 1);
  assert.equal((created[0] as { requests: unknown[] }).requests.length, 3);
  assert.equal(a.status, "failed", "'{}' is not a valid brief, so the schema parse fails");
  assert.match(a.status === "failed" ? a.error : "", /no parseable output/);
  assert.equal(a.costUsd, 0.5 * (10_000 * 4 + 1_000 * 20) / 1_000_000, "batch price is half");
  assert.match(c.status === "failed" ? c.error : "", /batch errored: overloaded_error/);
  assert.match(d.status === "failed" ? d.error : "", /no result returned/);
});

test("a spend check that refuses stops the batch before anything is sent", async () => {
  const created: unknown[] = [];
  let seen = 0;
  const b = briefingBatcher({ client: fakeClient(created), idleMs: 5, pollMs: 1, approve: (n, usd) => { seen = usd; throw new Error(`over cap: ${n} requests`); } });
  const r = await b.write(req(0));
  assert.equal(created.length, 0);
  assert.ok(seen >= 0.5 * 16000 * 20 / 1_000_000, "worst case counts the full max_tokens");
  assert.match(r.status === "failed" ? r.error : "", /over cap: 1 requests/);
});
