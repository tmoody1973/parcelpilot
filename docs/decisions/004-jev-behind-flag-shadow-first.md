# 004 — JEV runs behind a feature flag, in shadow mode first, and never sets the status

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** The decision layer has four modes: `rules_only`, `structured_output_baseline`, `jev`, and `shadow`. Production starts in `shadow` (JEV is called and logged on every run but ignored). A deploy-time check refuses `jev` mode unless the latest gold-set evaluation passed the PRD's launch gates. In every mode, a deterministic policy function sets the final status after applying hard overrides; JEV's output is one input to that function and can never make the result more permissive.

**Why this came up.** The PRD's real question is whether JEV improves routing over plain rules. If JEV is wired in as "the decider" from day one, there is no baseline to compare against and no way to ship if it under-performs.

**Options.**
1. JEV decides, rules as sanity check. Cost: unmeasurable value, and a model in the safety path before it has been evaluated.
2. Flag with shadow mode and policy-owned status (chosen). Cost: more code paths to test; a comparison dashboard to build.
3. No JEV until the gold set exists. Cost: no production traffic to learn from; the evaluation happens on synthetic data only.

**What we chose and why.** Option 2. Shadow mode gets real prepared states logged from the first real user without exposing anyone to an unvalidated decision.

**What we gave up.** Simplicity, and some latency per run while shadow calls happen (they run asynchronously so the user does not wait).

**How we'll know if this was right.** M6: the comparison dashboard shows JEV vs rules-only vs baseline on ≥ 50 expert-labeled cases; either JEV clears the gates and is switched on, or it is not and the product ships in `rules_only` with a documented negative result. Both are wins.

**Amendment, same day, from the TypeSafe docs.** Risk tier became a Score (ordered levels) instead of a Choice; the state JEV receives was stripped of numbers and free text because Jev 1.13 is documented as unreliable at arithmetic and steerable by adversarial text; a second bounded use, a citation-support check on the brief, was added as a validator that can only remove sentences.

**What actually happened.** _(Tarik fills in later.)_
