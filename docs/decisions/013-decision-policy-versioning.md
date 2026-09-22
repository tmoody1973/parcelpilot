# 013 — Decision policy: one versioned object in the repo, copied into the database; v1 action list

**Date:** 2026-09-22 · **Status:** decided · **Decided by:** Tarik (accepted the v1 action list 2026-09-22); Claude drafted and recommended · **Linear:** MOO-834

**Decision.** Every number and table the decision layer reads (the JEV thresholds, the rules-only decision table, and the list of next actions a memo may suggest) lives in one versioned object, `DECISION_POLICY_V1` in `packages/contracts/src/decisioning.ts`. Migration 0019 copies it into `decision_policy_versions`, each new run records which row it used, and a test fails if the two copies ever differ. A gold-case run carries its expert label on the run itself.

**Why this came up.** The design (05 §4.6) says thresholds must be "versioned JSON in the repo, id stored on each run", not constants in code. Without that, a later change to a threshold or to the route table would silently change what old runs appear to have meant, and the M6 evaluation couldn't tell which policy produced which answer.

**Options.**
1. **Repo object is the authority, the database holds a checked copy (chosen).** Changing policy means a code change, review and a new migration row. Cost: a policy change always needs a deploy, and the seed is written twice (TypeScript and SQL), which the equality test polices.
2. **Database is the authority, with an "active" flag an operator can flip.** Thresholds can change without a deploy. Cost: the running code and the flagged row can disagree, a flip isn't reviewed like code, and "which policy was live on Tuesday" needs an audit trail we don't have.
3. **Keep constants in code.** Cost: no id per run, which fails the design's reproducibility requirement.

**What we chose and why.** Option 1 (recommended by Claude, accepted by Tarik). Policy changes are rare and safety-relevant, so they should go through code review and CI like the rules engine does. The issue as written asked for "one row active at a time". That was dropped: the code decides which version is used, and the run stores that version's id.

**The v1 next-action list (accepted by Tarik).** The design names only the routes plus two example actions, so v1 is kept to what the validators already imply:

| Final status | Actions a memo may suggest |
|---|---|
| proceed_to_concept_design | proceed_to_concept_design |
| revise_scenario | revise_scenario, engage_zoning_professional |
| verify_before_committing | engage_zoning_professional, request_early_city_zoning_review |
| insufficient_evidence | collect_missing_information, contact_city (nothing else: the abstention check, 05 §7) |

Added on top, except for insufficient_evidence: `contact_city` when an overlay, special district, planned development, floodplain or GIS ambiguity is present; `collect_missing_information` when inputs are missing or several stacked-condo units match; `confirm_parking_configuration` when the parking finding needs verification.

**Expert labels on the run.** Gold cases are JSON files, not a table, so a gold run copies the case id, version, expected status and expected route onto `feasibility_runs`. The comparison view reads them from there. That keeps the label frozen with the run, even if the gold file is edited later.

**What we gave up.** Changing a threshold without a deploy. A single source for the seed: the SQL and TypeScript copies must be kept in step by hand, and the test only tells us when they drift. And a longer action vocabulary, which may prove too thin once real briefs are read in MOO-837/839.

**How we'll know if this was right.** In M5, every run from MOO-836 onward has a non-null `decision_policy_version_id`, and the equality test never needs to be skipped. In M6, the calibration work produces a `decision_policy.v2` as a normal reviewed PR, with no hand edit to the database. The briefing evaluation (MOO-837) doesn't hit `action_allowlist` removals from actions a reasonable memo needed.

**What actually happened.** _(Tarik fills in later.)_
