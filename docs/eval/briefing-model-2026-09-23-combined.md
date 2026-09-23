# Briefing model evaluation — 2026-09-23

Prompt `briefing.v2`, schema `briefing_output.v1`, effort model default, 15 gold case(s), one contract per case shared by every model. Measured by `pnpm briefing:eval`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.

| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-fable-5-1 | 15 | 87% | 73% | 87% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 85% | 361.4 s | $0.6178 | $9.27 |
| claude-sonnet-5 | 15 | 100% | 80% | 100% | 1.000 | 0% | 1.000 | 0 | 1 | 0 | 87% | 215.8 s | $0.1450 | $2.18 |
| claude-opus-5-5 | 15 | 100% | 87% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 87% | 42.8 s | $0.1879 | $2.82 |
| openai/gpt-6-sol | 15 | 93% | 80% | 93% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 86% | 23.7 s | $0.0499 | $0.75 |
| google/gemini-3.8-flash | 15 | 100% | 87% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 87% | 93.1 s | $0.0483 | $0.72 |
| openai/gpt-6-luna | 15 | 100% | 80% | 100% | 0.993 | 0% | 1.000 | 0 | 0 | 0 | 87% | 41.0 s | $0.0034 | $0.05 |
| moonshotai/kimi-k3 | 15 | 27% | 20% | 27% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 75% | 180.1 s | $0.0441 | $0.66 |
| deepseek/deepseek-v4.1-flash | 15 | 80% | 67% | 80% | 1.000 | 0% | 0.917 | 0 | 0 | 0 | 92% | 180.0 s | $0.0051 | $0.08 |
| claude-opus-5-5 (briefing.v2) | 15 | 100% | 100% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 100% | 49.0 s | $0.1929 | $2.89 |
| openai/gpt-6-sol (briefing.v2) | 15 | 100% | 100% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 100% | 27.2 s | $0.0536 | $0.80 |
| openai/gpt-6-luna (briefing.v2) | 15 | 100% | 100% | 100% | 1.000 | 0% | 1.000 | 0 | 0 | 0 | 100% | 38.7 s | $0.0034 | $0.05 |
| openai/gpt-6-luna-pro (briefing.v2) | 15 | 100% | 73% | 100% | 0.986 | 0% | 1.000 | 0 | 0 | 0 | 100% | 66.5 s | $0.0101 | $0.15 |

Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):

| Case | claude-fable-5-1 | claude-sonnet-5 | claude-opus-5-5 | openai/gpt-6-sol | google/gemini-3.8-flash | openai/gpt-6-luna | moonshotai/kimi-k3 | deepseek/deepseek-v4.1-flash | claude-opus-5-5 (briefing.v2) | openai/gpt-6-sol (briefing.v2) | openai/gpt-6-luna (briefing.v2) | openai/gpt-6-luna-pro (briefing.v2) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| G02 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ citation_precision |
| G03 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | –  | ✓ | ✓ | ✓ | ✗ citation_precision |
| G04 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✗ citation_precision |
| G05 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✗ citation_precision |
| G06 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✓ |
| G07 | – API error: Request timed out. | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✗ finding_coverage | ✓ | ✓ | ✓ | ✓ |
| G08 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✓ |
| G09 | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | – OpenRouter response is not JSON | ✗ abstention | ✓ | ✓ | ✓ | ✓ |
| G10 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✓ |
| G11 | ✓ | ✗ banned_hits | ✓ | ✓ | ✓ | ✗ citation_precision | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ | ✓ |
| G12 | – API error: Request timed out. | ✓ | ✓ | –  | ✓ | ✓ | – OpenRouter response is not JSON | – OpenRouter response is not JSON | ✓ | ✓ | ✓ | ✓ |
| G13 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| G14 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – OpenRouter response is not JSON | – schema-invalid output: executive_summary | ✓ | ✓ | ✓ | ✓ |
| G15 | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✗ abstention | ✓ | ✓ | ✓ | ✓ | ✓ |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10, claude-opus-5-5 $4 / $20 (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except none) openai/gpt-6-luna $0.10 / $0.50, google/gemini-3.8-flash $0.75 / $3.75, openai/gpt-6-sol $2 / $10, moonshotai/kimi-k3 $3 / $15, deepseek/deepseek-v4.1-flash $0.10 / $0.50 (list prices; open-weight hosts vary). Every brief, its contract hash and its checks are in `briefings-2026-09-23.jsonl`.
