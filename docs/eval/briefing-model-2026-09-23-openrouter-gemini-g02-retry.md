# Briefing model evaluation — 2026-09-23

Prompt `briefing.v1`, schema `briefing_output.v1`, effort model default, 1 gold case(s), one contract per case shared by every model. Measured by `pnpm briefing:eval`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.

| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| google/gemini-3.8-flash | 1 | 100% | 100% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 100% | 77.6 s | $0.0701 | $0.07 |

Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):

| Case | google/gemini-3.8-flash |
|---|---|
| G02 | ✓ |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10, claude-opus-5-5 $4 / $20 (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except none) openai/gpt-6-luna $0.10 / $0.50, google/gemini-3.8-flash $0.75 / $3.75, openai/gpt-6-sol $2 / $10. Every brief, its contract hash and its checks are in `briefings-2026-09-23.jsonl`.
