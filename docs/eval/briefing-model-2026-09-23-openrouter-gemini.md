# Briefing model evaluation — 2026-09-23

Prompt `briefing.v1`, schema `briefing_output.v1`, effort model default, 15 gold case(s), one contract per case shared by every model. Measured by `pnpm briefing:eval`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.

| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| google/gemini-3.8-flash | 15 | 93% | 80% | 93% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 86% | 93.1 s | $0.0436 | $0.65 |

Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):

| Case | google/gemini-3.8-flash |
|---|---|
| G01 | ✓ |
| G02 | – OpenRouter HTTP 502: {"error":{"message" |
| G03 | ✓ |
| G04 | ✓ |
| G05 | ✓ |
| G06 | ✓ |
| G07 | ✓ |
| G08 | ✓ |
| G09 | ✗ abstention |
| G10 | ✓ |
| G11 | ✓ |
| G12 | ✓ |
| G13 | ✓ |
| G14 | ✓ |
| G15 | ✗ abstention |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10 (thinking billed as output); via OpenRouter (strict structured outputs, no data retention) openai/gpt-6-luna $0.10 / $0.50, google/gemini-3.8-flash $0.75 / $3.75. Every brief, its contract hash and its checks are in `briefings-2026-09-23.jsonl`.
