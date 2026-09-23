# 016 — Gold cases become real runs through the gold recipe, in their own org

**Date:** 2026-09-23 · **Status:** decided · **Decided by:** Tarik (options below); Claude proposed and built · **Linear:** MOO-840

**Decision.** `pnpm decision:gold` turns each gold case into a real locked run, and then runs the same after-lock steps a user's run goes through: freeze evidence, ask JEV in shadow, write the brief, render the memo.
- **The lock uses the gold recipe.** The run's status comes from `goldDecision`: the same engine, citation gate and policy code a live run calls. It does not go through `runScenario`.
- **Isolation.** The runs belong to one internal org, `parcelpilot-gold`. Each case gets its own parcel snapshot under a made-up taxkey (`GOLD-G01`, `GOLD-G02`, …).

**Why this came up.** MOO-840 needs one shadow comparison per gold case, stored in the database, for a reviewer to look at. A comparison row can only point at a real run, and a real run must point at a project, a scenario and a parcel snapshot. `runScenario`, the function behind the "Run" button, builds a run from the parcel's latest stored snapshot. The gold set deliberately bends the facts, and that function cannot express those cases:
- G11 adds an overlay, G12 a planned development, and G14 a zoning sliver, none of which the real parcels have.
- G13 is blocked before any run exists.
- G15 marks a source as superseded.

There was also a data-safety risk. A live run reads the *latest* snapshot for a taxkey. Storing G12's made-up planned development under the real taxkey `2080863000` would make the next real screen of that parcel wrong.

**Options.**
1. **Gold recipe for the lock, live code after it (chosen).** Cost: `runScenario`'s own snapshot-reading code isn't exercised by this command. `gold.test.ts` and live runs cover that part.
2. **Seed fake data, then call `runScenario`.** Cost: needs fake snapshots, fake map intersections, and a real shared source marked superseded. That's about twice the code, it touches shared data, and G13 still can't be expressed.

**What we chose and why.** Option 1. The steps MOO-840 measures all happen after the lock, and those are the live code with no substitutes: evidence, JEV, the brief, the checks, the memo. The lock itself uses the recipe `gold.test.ts` already proves reproduces every expected status.

**Definitions used for the metrics** (05 §9 names them without defining them):
- **High-risk case:** the expert's expected status is anything other than `proceed_to_concept_design` (13 of 15).
- **Recall on high-risk:** the share of those cases where JEV also did not say proceed.
- **Unsafe-permissive:** JEV says proceed while the rules table or the expert says otherwise. This is the same rule as the `decision_comparisons` view (migration 0019), and CI fails if the count is above 0.

**Who can see gold runs.** The reviewer page reads them in a transaction scoped to the gold org. That keeps the database's per-org row filter (row-level security) in force, instead of using the all-access service connection, which is reserved for shared tables. A reviewer in any org can see the gold set; nothing else in the gold org is exposed, because nothing else is there.

**What we gave up.**
- Every `decision:gold` run adds 15 more runs to the gold org. The page shows only the latest run per case, and old runs pile up.
- A gold calculation row can't point at a database rule: gold rule ids are readable slugs (`lb1-use-v1`), while the database uses UUIDs. The slug is kept inside the stored finding instead.
- The CI gate uses JEV's answers *recorded* on 2026-09-23. It catches a code or gold-set change that would make those answers unsafe, but not a change in JEV itself. Re-running `decision:gold` re-records them.

**How we'll know if this was right.**
- CI stays green on unsafe-permissive across M6 as the gold set grows to 50 cases.
- No real parcel's screen ever shows a gold-only fact. Check: `select count(*) from parcel_snapshots where taxkey like 'GOLD-%'` matches the rows `decision:gold` created, and no real taxkey has a snapshot with `source_layer = 'gold-case'`.

**What actually happened.** _(Tarik fills in later.)_
