# 010 — Footnote policy: model only reviewer-flagged footnotes; everything else routes to "verify"

**Date:** 2026-09-22 · **Status:** proposed · **Decided by:** Claude (draft, Q-05 default), Tarik to confirm or amend · **Linear:** MOO-825

**Decision.** A dimensional-table footnote (the asterisk notes under Table 295-505-2, 295-605-5 and their kin) is modelled as an evaluable rule condition only when a reviewer flags it as commonly triggered and writes the condition. Every other footnote, and every table cell that is not a plain number ("average", "see s. …", an asterisk), becomes a non-evaluable condition on the rule it touches, which forces that category to "verify before committing" whenever the rule applies. Nothing in a footnote is ever turned into a number by code.

**Why this came up.** Open question Q-05: a footnote can flip a value (corner lots, alleys, adjacent districts, "in lieu of" tables). Ignoring one turns a deterministic "pass" into a wrong answer, the worst failure this product can have. Modelling every footnote as its own reviewed row is the most correct option and multiplies reviewer hours, which today means one person.

**Options.**
1. **Every footnote gets its own reviewed row.** Cost: for the residential table alone, six footnotes across four pages, each needing a written predicate and a parcel fact the app may not have (adjacent lot's storey count, corner lot). Review time scales with footnotes, not with rules.
2. **Only reviewer-flagged footnotes are modelled; the rest force "verify" (chosen).** Cost: some parcels get "verify" where a modelled footnote would have said "pass" or "fail". The gap is visible on screen and in the memo, not hidden.
3. **Code parses footnotes into numbers.** Cost: exactly the silent-number failure Z-05 forbids; a language model reading prose is not evidence.

**What we chose and why.** Option 2, the product's existing "visible unknown" pattern (PRD Z-06). It is what MOO-825's extractor does: the LB3 and RB1 "average" front-setback cells became `average_front_setback` conditions with `evaluable: false`, citing the cell, and the engine will route those categories to verify. When a reviewer decides a footnote is common enough to model (the corner-lot ones are the likely first), they add an evaluable condition with a `when` predicate over a parcel fact, cite the footnote, and approve it through the queue like any rule change.

**How a flag works.** The queue already carries one `footnote_review` task per footnote (MOO-819). Marking one "reviewed" records that a person read it; a footnote that should be modelled is handled by editing the affected candidate (adding the condition) and approving it, so the change is a new rule version with the footnote as its citation. No separate flag table is needed for v1.

**What we gave up.** Precision on parcels where a modelled footnote would have settled the answer. Until a footnote is modelled, the screen says "verify" rather than "pass", which costs the user a professional's confirmation.

**How we'll know if this was right.** The M6 comparison: if more than a small share of "verify" outcomes on the gold set trace to non-evaluable conditions that a modelled footnote would have resolved, promote those footnotes to evaluable conditions. If a "pass" is ever found to be wrong because of an unmodelled footnote, this decision was wrong and option 1 applies to that table.

**What actually happened.** _(Tarik fills in later.)_
