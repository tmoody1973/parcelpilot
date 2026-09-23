# Briefing model evaluation — 2026-09-23

Prompt `briefing.v2`, schema `briefing_output.v1` with each contract's own output schema, effort medium, Message Batches API (half price; latency is time to batch completion), 1 gold case(s). Every brief ran the production path: the eleven 05 §7 validators (with decision 015's refinements) and at most one repair; "validated" means a user would see the model's brief, anything else means the templated brief. Measured by `pnpm briefing:eval`.

| Model | Briefs | Validated | Repaired (fixed) | No answer | p95 latency (incl. repair) | Cost per brief (incl. repair) | Cost this run |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | 1 | **100%** | 0 (0 fixed) | 0 | 182.4 s | $0.0972 | $0.10 |

What each validator did to the final attempts: **hard failures** (brief fell back) / sentences or actions removed.

| Model | schema | contract_hash | status_lock | citation_membership | uncited_claim | numeric_alignment | action_allowlist | banned_phrases | finding_coverage | abstention | unknown_as_pass |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | · | · | · | · | · | 0 / 1 | · | · | · | · | · |

Per case (✓ validated, ✗ fell back, with the validators that failed it; – no answer):

| Case | claude-opus-5-5 |
|---|---|
| G01 | ✓ |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10, claude-opus-5-5 $4 / $20 (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except none) openai/gpt-6-luna $0.1 / $0.5, openai/gpt-6-luna-pro $0.1 / $0.5, google/gemini-3.8-flash $0.75 / $3.75, openai/gpt-6-sol $2 / $10, moonshotai/kimi-k3 $3 / $15, deepseek/deepseek-v4.1-flash $0.1 / $0.5 (list prices; open-weight hosts vary). Every attempt, its validator results and the final brief are in `briefings-2026-09-23-batch-trial.jsonl`; contracts are stored by hash in `docs/eval/.contracts` (not committed).
