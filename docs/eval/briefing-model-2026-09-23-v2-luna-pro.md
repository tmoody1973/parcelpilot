# Briefing model evaluation — 2026-09-23

Prompt `briefing.v2`, schema `briefing_output.v1`, effort model default, 15 gold case(s), one contract per case shared by every model. Measured by `pnpm briefing:eval`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.

| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openai/gpt-6-luna-pro | 15 | 100% | 73% | 100% | 0.986 | 0% | 1.000 | 0 | 0 | 0 | 100% | 66.5 s | $0.0101 | $0.15 |

Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):

| Case | openai/gpt-6-luna-pro |
|---|---|
| G01 | ✓ |
| G02 | ✗ citation_precision |
| G03 | ✗ citation_precision |
| G04 | ✗ citation_precision |
| G05 | ✗ citation_precision |
| G06 | ✓ |
| G07 | ✓ |
| G08 | ✓ |
| G09 | ✓ |
| G10 | ✓ |
| G11 | ✓ |
| G12 | ✓ |
| G13 | ✓ |
| G14 | ✓ |
| G15 | ✓ |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices per million input / output tokens: claude-fable-5-1 $10 / $50, claude-sonnet-5 $2 / $10, claude-opus-5-5 $4 / $20 (thinking billed as output); via OpenRouter (strict structured outputs, no training on data, zero data retention except openai/gpt-6-luna-pro) openai/gpt-6-luna $0.10 / $0.50, google/gemini-3.8-flash $0.75 / $3.75, openai/gpt-6-sol $2 / $10, moonshotai/kimi-k3 $3 / $15, deepseek/deepseek-v4.1-flash $0.10 / $0.50 (list prices; open-weight hosts vary). Every brief, its contract hash and its checks are in `briefings-2026-09-23.jsonl`.
