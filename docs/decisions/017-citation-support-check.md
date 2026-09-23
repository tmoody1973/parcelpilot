# 017 — The citation-support check ships off; its review tasks hold pointers only

**Date:** 2026-09-23 · **Status:** decided (default off); the default is revisited in M6 · **Decided by:** Tarik (review-task design); Claude measured · **Linear:** MOO-841

**Decision.** The twelfth brief check, `citation_support`, is built and measured but ships **off**. It asks JEV whether each cited excerpt actually supports its sentence. It turns on only with `CITATION_SUPPORT_CHECK=true`, or `--citation-support` on `pnpm decision:gold`.

When it is on:
- It runs once, on a brief that already passed the eleven deterministic checks, in one JEV request per brief.
- A sentence stays if any excerpt it cites supports it.
- A removal needs every "doesn't support" answer at 0.8 or above to stand on its own. Below that, the sentence is still removed and is also queued for review.
- Losing a `finding` sentence, the eleven failing on what is left, or JEV not answering all send the brief to the template.

Low-confidence removals become **pointer-only** review tasks. A task holds the brief's record id, the sentence id, the verdict and the confidence, never the sentence text. The shared review queue leaves them out.

**Why this came up.** MOO-841 asked for low-confidence removals to go to `review_tasks`. That table is shared by every org and has no per-org row filter, and any org's owner, admin or reviewer can open the review queue. A task carrying a sentence from one customer's brief would let another customer read it.

**Options (review tasks).**
1. **Pointer-only tasks, kept out of the shared queue (chosen by Tarik).** Cost: a one-line migration (0021). Nobody can work these tasks in the UI until a viewer that checks the brief's org exists.
2. **Record them only in `validation_runs`.** Cost: departs from the AC, and there is no task list to sample from.
3. **Full tasks with text in the shared queue.** Cost: one customer could read another customer's brief.

**What the measurement says** (`docs/eval/citation-support-2026-09-23.md`: 15 gold briefs, 297 pairs, live JEV):
- **Working as designed on a clear case.** A claim cited to an unrelated row is caught with certainty (the planted pair: says_nothing at 1.00).
- **Too costly on real briefs.** It removed 24 sentences, and 8 of 15 briefs would fall back to the template. Without it, all 15 validate.
- **The hand check found no false claims.** Of five removals checked, none was false. Three were true sentences whose real source is the contract (parcel facts, findings, triggers), not the ordinance excerpt they cite. Two were near-verbatim support that JEV missed at low confidence (0.59, 0.34).
- **Cheap and fast.** $0.00018 per brief; p95 322 ms; 0 failures.

**What we chose and why.** Off. Turned on today it would hide correct briefs more than half the time and catch no false claims on the gold set. That is the same trade decision 012 turned down for the reranker. The code, the flag, the logging and the review-task path are in place, so it can be switched on as soon as a better-shaped version measures well.

**What we gave up.** Until it is on, nothing checks that a cited excerpt says what its sentence claims. A number quoted from an off-topic excerpt (decision 015's known gap) is still not caught.

**How we'll know when to turn it on.** Re-run `pnpm citation-support:eval` after changing its shape. Two candidates, measured on the same 15 briefs:
- **Scope.** Ask only about `code` sentences, because `fact` and `finding` sentences rest on the contract, not an excerpt. Or give JEV the contract's facts alongside the excerpt.
- **Low confidence.** Below 0.8, keep the sentence and send it to review instead of removing it.

Turn it on only if briefs falling back stay at or under 1 of 15, and a hand check of the removals finds most of them actually unsupported.

**What actually happened.** _(Tarik fills in later.)_
