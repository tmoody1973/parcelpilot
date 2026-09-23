# Briefing model evaluation — 2026-09-23

Prompt `briefing.v1`, schema `briefing_output.v1`, effort model default, 15 gold case(s), one contract per case shared by every model. Measured by `pnpm briefing:eval`. Checks are pre-validator approximations of 05 §9, not the MOO-838 validators; a brief "passes" only if every check does. No brief from this run is shown to users.

| Model | Briefs | Schema-valid | All checks pass | Status echoed | Citation precision | Uncited claims | Fail/verify coverage | Invented numbers | Banned phrases | Disallowed actions | Abstention correct | p95 latency | Cost per brief | Cost this run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-fable-5-1 | 15 | 87% | 60% | 87% | 1.000 | 0% | 1.000 | 6 | 0 | 0 | 85% | 361.4 s | $0.6178 | $9.27 |
| claude-sonnet-5 | 15 | 100% | 40% | 100% | 1.000 | 0% | 1.000 | 11 | 1 | 0 | 87% | 215.8 s | $0.1450 | $2.18 |

Per case (✓ all checks pass, ✗ a check failed, – no schema-valid answer):

| Case | claude-fable-5-1 | claude-sonnet-5 |
|---|---|---|
| G01 | ✓ | ✓ |
| G02 | ✓ | ✗ invented_numbers |
| G03 | ✗ invented_numbers | ✗ invented_numbers |
| G04 | ✓ | ✗ invented_numbers |
| G05 | ✗ invented_numbers | ✗ invented_numbers |
| G06 | ✓ | ✓ |
| G07 | – API error: Request timed out. | ✗ invented_numbers |
| G08 | ✓ | ✓ |
| G09 | ✗ abstention | ✗ abstention |
| G10 | ✓ | ✓ |
| G11 | ✓ | ✗ banned_hits, invented_numbers |
| G12 | – API error: Request timed out. | ✓ |
| G13 | ✓ | ✓ |
| G14 | ✓ | ✗ invented_numbers |
| G15 | ✗ abstention | ✗ abstention |

Banned phrases checked: approved, fully compliant, by right, permitted, compliant. Prices: claude-fable-5-1 $10 / $50 and claude-sonnet-5 $2 / $10 per million input / output tokens (thinking billed as output). Every brief, its contract hash and its checks are in `briefings-2026-09-23.jsonl`.
