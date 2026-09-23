# 014 — Briefing model: Claude Opus 5.5 at effort medium, with GPT-6 Luna as the evaluated backup

**Date:** 2026-09-22 · **Status:** decided · **Decided by:** Tarik (on the measured table below); Claude measured, researched and recommended · **Linear:** MOO-837

**Decision.** Briefs are written by `claude-opus-5-5` at effort `medium`, with the prompt `prompts/briefing.v2.md`. GPT-6 Luna stays wired through OpenRouter and evaluated as the backup, but is not used for real users: it has no zero-data-retention route. No brief reaches a user until the MOO-838 validators pass it; until then every brief is logged as `fallback` and the templated brief is what users see.

**Why this came up.** The brief is the only place a language model writes words a user reads, so the model has to follow hard rules: cite only the supplied ordinance excerpts, never do arithmetic, never use verdict words ("approved", "permitted"), and say nothing about feasibility when the screen lacks evidence. The design (05 §6) named two Claude candidates and said to pick the cheapest that meets the gates. Tarik widened the field mid-evaluation to cheaper and newer models from other vendors.

**How it was measured.**
- `pnpm briefing:eval` ran every gold case through the same engine → citation gate → policy chain a live run uses, then froze its evidence with offline retrieval and built one contract per case.
- Every model got the same contract per case, with one caveat: fresh retrieval is not bit-reproducible (embeddings of a repeated question can differ in the last digits, so near-tied evidence can swap). A few runs therefore briefed G03, G05 or G12 from a slightly different contract. The rescore scored each brief against the exact contract it was written from; two briefs whose contract version could not be rebuilt were scored in their own run (Sol v1 G12 passed, DeepSeek G03 failed). Future runs save the contract with each brief.
- Each brief was scored by quick deterministic checks:
  - status and hash echoed back;
  - disclaimer exact;
  - every cited id exists in the contract, and every factual sentence cites one;
  - every fail or verify finding is covered;
  - only allowed actions;
  - no banned phrases and no numbers absent from the contract;
  - no verdict on an insufficient-evidence case.
- These checks approximate 05 §9. They are not the MOO-838 validators.
- Full data: `docs/eval/briefing-model-2026-09-23-combined.md` and the `briefings-2026-09-23*.jsonl` files beside it.

**Round 1: prompt v1, each model at its default effort.**

| Model | Passed all checks (of 15) | Real failures | Cost per brief | Slowest 5% |
|---|---|---|---|---|
| Claude Opus 5.5 | 13 | G09, G15 abstention | $0.19 | 43 s |
| GPT-6 Sol | 13 | G09, G15 abstention | $0.05 | 24 s |
| Gemini 3.8 Flash | 13 | G09, G15 abstention | $0.048 | 93 s |
| GPT-6 Luna | 12 | abstention; 1 citation not in the contract | $0.003 | 41 s |
| Claude Sonnet 5 | 12 | abstention; 1 banned phrase ("permitted use") | $0.145 | 216 s |
| Claude Fable 5.1 | 11 | abstention; 2 timeouts | $0.62 | 361 s |
| DeepSeek V4.1 Flash | 10 | missed covering a failed finding; 2 calls failed | $0.005 | 180 s |
| Kimi K3 | 3 | 10 of 15 timed out at the 180 s limit | $0.044 | 180 s |

Every model failed G09 and G15, the insufficient-evidence cases. The cause was the prompt, not the models. v1 told the model both to "explain every fail" and, on insufficient evidence, to "give no opinion", and G09 has a density fail under an insufficient-evidence status. The same tension sits in 05 §7 between `finding_coverage` and `abstention`.

**Round 2: prompt v2, the three leaders, effort stated as medium.** v2 replaced the two competing rules with one policy: every finding still gets an entry, but under insufficient evidence only as "result withheld, because …". It also borrowed three things from sources Tarik shared: the context / outcome / rules / evaluation layout (Elser AI's GPT-5.6 guide), "gaps go to open questions", and a four-sentence cap on the summary (OpenAI's prompt guide).

| Model | Passed all checks (of 15) | Cost per brief | Slowest brief |
|---|---|---|---|
| **Claude Opus 5.5** | **15** | $0.19 | 49 s |
| GPT-6 Sol | 15 | $0.053 | 27 s |
| GPT-6 Luna | 15 | $0.003 | 39 s |
| GPT-6 Luna Pro (more thinking) | 11 | $0.010 | 67 s |

**Options.**
1. **Opus 5.5 at effort medium, Luna as the evaluated backup (chosen by Tarik).** Cost: $0.19 per brief, or $190 per thousand. It needs no new vendor and no new data exposure, because Anthropic is already the provider. On a read of G11, its briefs are the clearest and most complete of the three.
2. **GPT-6 Luna, the cheapest that meets the gates.** Cost: $0.003 per brief. It adds OpenRouter and OpenAI as production vendors. OpenRouter offers no zero-retention route for it, so real users' contracts would be kept by OpenAI for up to about 30 days under its standard terms, which were not verified for these endpoints.
3. **GPT-6 Sol.** Cost: $0.053 per brief. It is the fastest, but its briefs are the thinnest, with a two-sentence summary on G11. It has the same data exposure as Luna.

**What we chose and why.** Option 1, chosen by Tarik. All three models met the checks, so "cheapest that passes" would have meant Luna, about 57 times cheaper than Opus 5.5 ($0.0034 against $0.193). It lost for two reasons. First, the missing zero-retention route turns the choice into a data decision rather than a price one. Second, at pilot volume the whole price difference is under $200 per thousand briefs, while how clearly the brief reads is the product.

**What we gave up.**
- About 57 times the per-brief cost of Luna.
- A second provider in the production path.
- A ranking that isn't based on measured quality. The "clearest brief" judgement comes from reading one case, not from a metric, and the checks can't tell the three apart.
- Byte-identical briefs. Opus 5.5 rejects sampling settings such as temperature (and OpenAI advises dropping them on its reasoning models), so the same contract can give differently worded briefs.
- A server-side refusal fallback. A refusal becomes the templated brief, not another model's answer.

**How we'll know if this was right.**
- MOO-838 re-runs the eval on Opus 5.5 with the validators in place, three runs per case. It should pass every validator on at least 14 of 15 cases in every run, with no case flipping between pass and fail.
- If Luna matches that under the same validators, and a zero-retention route appears or Tarik accepts OpenAI's retention for production, switch and record it as a new decision.
- Re-run the comparison whenever the prompt version changes.

**Evaluation cost.** About $21 across all models, rounds and retries, of which Claude Fable 5.1 alone was $9.27.

**What actually happened.** _(Tarik fills in later.)_
