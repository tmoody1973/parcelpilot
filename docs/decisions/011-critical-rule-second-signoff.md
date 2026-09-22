# 011 — Critical rules need the owner's sign-off; a reviewer's approval is a first sign-off, not a rule

**Date:** 2026-09-22 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm · **Linear:** MOO-819

**Decision.** When a reviewer approves a rule candidate whose criticality is `critical` (the rules most likely to decide a feasibility call: use, height, density), no rule is created. The candidate stays in review with that reviewer recorded as the first sign-off, and only an approval by a member with the `owner` role mints the rule. An owner's approval mints directly, with or without a prior reviewer sign-off. Every other criticality mints on the first approval by any reviewer. (Decision 010 is reserved for the footnote policy in MOO-825.)

**Why this came up.** `04_zoning_rag_design.md` §10 step 5 says a single reviewer's approval is not sufficient for a critical rule: "a second reviewer, or Tarik directly, [must] sign off". The queue backend had to pick one concrete rule for who counts as the second signature, because two readings were possible and the product owner is today the only reviewer (memory: interim reviewer, do not block on recruiting an expert).

**Options.**
1. **Any two distinct reviewers.** Cost: with one reviewer on the project, every critical rule is stuck until a second person exists, so LB3/RB1/RB2 (MOO-825) could not ship.
2. **Owner's approval always required, owner can approve alone (chosen).** Cost: the owner becomes a bottleneck for critical rules; a reviewer cannot finish a critical rule end to end.
3. **No second sign-off; criticality only affects the policy floor.** Cost: contradicts the design doc and removes the one human check on the rules with the highest blast radius.

**What we chose and why.** Option 2. It satisfies both halves of §10 step 5 today (a reviewer alone cannot mint a critical rule; Tarik directly can) and needs no new roles. The first sign-off is kept on the candidate (`reviewer_id`) and as an audit row (`rule.first_approved`), so when a second reviewer exists the history already shows who looked first.

**What we gave up.** Reviewer autonomy on critical rules, and the "two independent eyes" property when the owner approves alone. If the team grows, option 1 can be layered on top by requiring `reviewer_id` to be set and different from the approver before an owner mints.

**How we'll know if this was right.** MOO-825: the LB3/RB1/RB2 use and height candidates are critical; Tarik approves them in the UI and the audit trail shows one `rule.approved` per rule with `approved_by` = Tarik. If any critical rule sits in `in_review` for more than a week waiting on the owner, the bottleneck is real and option 1 should be revisited.

**What actually happened.** _(Tarik fills in later.)_
