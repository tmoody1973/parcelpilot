# 018 — The gold-set review: shops over apartments proceed; mixed use is judged by its parts; a clear fail says "revise"

**Date:** 2026-09-26 · **Status:** decided · **Decided by:** Tarik (as interim reviewer, on Claude's recommendations) · **Linear:** MOO-843, follow-ups MOO-850 and MOO-851

**Decision.** Tarik labeled all 50 gold cases. He approved 44 drafts and changed 6, and three rules came out of the review:
1. **A ground-floor shop doesn't stop "proceed".**
   - The only limited-use standard on "Retail establishment, general" in LB1/LB2 is an hours limit: not operated 12 a.m.–5 a.m. within 150 ft of a residential district (s. 295-603-2-h, CH295-sub6 PDF p. 8).
   - It doesn't change whether to design the building, so apartments over a shop, or a shop as the main use, can proceed.
   - The memo should mention the hours limit (MOO-851).
2. **Mixed use is judged by its parts.**
   - Table 295-603-1 has no mixed-use row, so the seeded rule's `mixed_use: L` and `commercial: L` entries are not ordinance text.
   - A building is judged by its apartments ("Multi-family dwelling") and its shop ("Retail establishment, general").
   - The engine change is MOO-850.
3. **A clear fail tells the user to revise, even when something else is unknown.**
   - In LB2 the front-setback maximum is always unknown (the average of neighbouring buildings).
   - When a case also clearly fails (too many units, too tall, too short, a use that isn't allowed), the right advice is "revise the scenario", not "engage a zoning professional". The unknown setback is secondary.

**Why this came up.** The M6 launch gates score JEV against these labels, so they must be what a good answer *is*, not what the engine happens to do today. Claude drafted every case and flagged two questions it couldn't settle from the code. The review surfaced a third: the policy table ranks "verify" above "revise", so an LB2 case with a real fail was being sent to a professional.

**Options (question 1).**
- **Keep proceed (chosen).** The shop's only condition is operating hours. Cost: the product still doesn't check that condition. The memo note (MOO-851) makes it visible.
- **Verify every shop.** Cost: sends people to a zoning professional over opening hours, the over-cautious non-answer PRD §9.5 / Q-06 warns about. It also drops the proceed cases below the 12-case minimum.

**Options (question 2).**
- **Judge by the parts (chosen).** Cost: an engine change (MOO-850).
- **Keep the invented entry.** Cost: the product would rely on a rule the City never wrote, even when it happens to give a safe answer.

**Options (clear fail plus an unknown).**
- **"Revise" (chosen).** Cost: the policy table currently says otherwise, so four LB2 cases (G07, G08, G28, G31) disagree with the rules-only result until the policy changes.
- **Keep "engage a professional".** Cost: hides the message the user needs, which is that the plan breaks a rule.

**What changed in the gold set.**

| Case | Drafted route | Reviewer's route |
|---|---|---|
| G07, G08, G28, G31 | engage_zoning_professional | revise_scenario |
| G47, G48 | engage_zoning_professional | proceed_to_concept_design |

The drafted answers stay in each case as `expected` (what the engine must reproduce). The reviewer's answer is `review.label`, which the gates score against. So all six show up in the gate report as rules-only disagreements, until MOO-850 and a policy change land.

**What we gave up.** These are product-owner labels, not an independent zoning expert's. Claude drafted the cases and recommended an answer on each, so the review isn't fully independent of Claude. And with one labeler, reviewer agreement (Q-28) can't be measured.

**How we'll know if this was right.** When a zoning professional reviews a sample, count how many of these 50 labels they would change. Rules 1 and 3 in particular should be checked with someone who files in Milwaukee.

**What actually happened.** _(Tarik fills in later.)_
