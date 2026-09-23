# 015 — Two brief validators match their intent, not their letter; no number placeholders

**Date:** 2026-09-22 · **Status:** decided · **Decided by:** Tarik (on the measurements below); Claude measured and recommended · **Linear:** MOO-838

**Decision.** Two of the eleven 05 §7 brief validators are implemented to match what they are for, rather than their literal wording.
1. **`numeric_alignment`.** §7 allows only numbers from the calculation records and the parcel facts. The refinement also allows:
   - a number that appears in the text of an excerpt the sentence itself cites;
   - the user's own scenario inputs;
   - plain counts of the contract's own lists, when the count is not a measurement.
   Section, table and chapter references ("s. 295-403-2", "Chapter 295") are treated as names, not numbers.
2. **`unknown_as_pass`.** §7 fails the brief when a "finding" sentence *mentions* an unchecked category. The refinement fails it only when a clause *claims* an unchecked category passed or meets a standard. "Parking was not checked" is fine; "parking meets the standard" fails.

The number-placeholder scheme proposed in MOO-838 (the model writes `{{f2.proposed}}` and code fills it in) is not built.

**Why this came up.** Before tuning anything, we ran all 180 briefs saved from the MOO-837 evaluation through the literal §7 rules. Two rules were failing correct briefs:
- **Numbers.** Faithful ordinance quotes were being rejected: "Table 295-605-2 sets the minimum lot area per dwelling unit at 1,200 sq ft" is copied from the cited excerpt, not computed. Under the literal rule, Opus 5.5, the chosen default, failed 12 of 15 cases on v2.
- **Unknown categories.** Almost every hit was a correct sentence saying a category was *not* checked: "Parking was not checked; the screen has no reviewed rule for it, so it is unknown, not passed."

A validator that rejects correct briefs doesn't make the product safer. It just shows the templated brief more often, and hides whether the model is actually wrong.

**Options.**
1. **Refine both rules to their intent, skip placeholders (chosen by Tarik).** Cost: the number rule trusts a citation as grounding, so a model could cite an excerpt and quote a number from it that is true there but irrelevant to the sentence.
2. **Refine both and also build placeholders.** Cost: a new prompt version, substitution code, and another evaluation. Placeholders also would not fix either false alarm, because an ordinance quote has no calculation to point at.
3. **Keep §7 literal.** Cost: most briefs fall back to the template even when they are correct.

**What we chose and why.** Option 1. The refined number rule still catches what §7 exists to stop: invented numbers and arithmetic. "Roughly 32,000 sq ft" is in no excerpt, so it is removed. The citation becomes the proof, which the model is already required to supply. The refined unknown-category rule still catches the actual failure, implying an unchecked category passed.

**Measured effect**, on the same 180 saved briefs, with each brief checked against its own contract:

| | Literal §7 | Refined |
|---|---|---|
| Opus 5.5, prompt v2 | 3 of 15 validated | **15 of 15** validated (9 briefs had an uncited-number sentence removed, not failed) |
| GPT-6 Sol, prompt v2 | 14 of 15 | 15 of 15 |
| GPT-6 Luna, prompt v2 | 13 of 15 | 15 of 15 |
| Real failures still caught | — | every v1 abstention failure on G09 and G15; Luna's invented citation id; Sonnet's "permitted use" |

**What we gave up.**
- A number quoted from a cited but off-topic excerpt passes the number rule. For example, a sentence about height that cites the density row and quotes its 1,200 would pass.
- The unknown-category rule works on wording ("not", "unknown", "passed", "meets"), so an unusual phrasing could slip past it.
- Both are covered in part by other validators (`citation_membership`, `uncited_claim`) and by MOO-841's planned check that each citation really supports its sentence.
- No placeholder system. Numbers in briefs are still written by the model and checked afterwards, not filled in by code.

**How we'll know if this was right.**
- In the MOO-838 three-run evaluation and later real use, count briefs that show a number or an unknown-category claim a reviewer judges wrong. The target is zero.
- If MOO-841's citation-support check finds numbers quoted from off-topic excerpts, tighten the rule to require that the excerpt be about the same finding.

**What actually happened.** _(Tarik fills in later.)_
