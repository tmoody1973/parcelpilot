# 08 — Open questions

**Status:** planning draft, 2026-09-21. Written by Claude for Tarik's review.

This lists every decision engineering cannot safely guess: what we already know (confirmed live, or just found in a document — see `00_source_verification.md`), the realistic options with real cost, a recommended default, who decides, and which milestone (M0–M6, per `06_delivery_plan.md` and `00_conventions.md`) it's needed by. A "default" is not a decision — it's what gets built if nobody answers in time, chosen to be the safest, most reversible option. Every A#-numbered item from `01_product_scope.md` §5 appears below by ID. Every answered question becomes a dated entry in `docs/decisions/` — see the pointer at the end.

---

## Product & domain

### Q-01 — Which 2–4 zoning districts does the first slice target? *(covers A1)*

> **Answered (Tarik, 2026-09-21, decision 007):** LB1, LB2, LB3, RB1, RB2. Demo district LB1. Expert reviewer to ratify when recruited. See `00_conventions.md` v1 scope.
**Why:** Building rules, tables, and test parcels for the wrong district wastes the most expensive resource — reviewer hours — twice.
**What we know:** Candidates confirmed by reading the actual Ch.295 PDFs: residential `RM1–RM7` (subchapter 5), commercial `NS1, NS2, LB1, LB2, LB3, RB1, RB2` (subchapter 6). No data on which districts Milwaukee small-infill deals actually use.
**Options:** 1) Pick 2 now — cheap, but wrong districts sink the pilot. 2) Pick 1 for the first demoable slice, expand after M3 proves out — slower, but proves the risky chain (rules engine, memo, safety policy) before spending reviewer time on district #2.
**Default:** Option 2 — one `RM` district first (a guess about infill entry points, not a Milwaukee-specific fact).
**Decider / Needed by / Blocks:** Tarik + Domain reviewer / M0 / M3 rule authoring, the demoable slice itself.

### Q-02 — Are use, height, and setbacks really the right first three checks? *(covers A2)*
**Why:** If parking is the actual deal-killer in Milwaukee infill, the pilot validates the wrong thing while looking complete.
**What we know:** Nothing Milwaukee-specific — carried from the PRD as an assumption, not a verified fact.
**Options:** 1) Keep as-is — fastest, rests on a guess. 2) Confirm against 3–5 real recent Milwaukee deals with the reviewer — a few hours, removes the guess.
**Default:** Option 2, as a quick confirmation, not a research project.
**Decider / Needed by / Blocks:** Domain reviewer / M0 / rule-category list in `01_product_scope.md` §2, M3 scope.

### Q-03 — Which one extra rule category: density, parking, or lot coverage? *(covers A3)*
**Why:** Parking tables are the most footnote-heavy in Ch.295, per `00_source_verification.md` — highest extraction risk of the three, and a wrong rule is worse than none.
**What we know:** Dimensional sections `295-505`/`295-605` exist (confirmed); their table IDs and footnote structure are not yet transcribed.
**Options:** 1) `parking` — most likely to be decision-relevant, highest extraction risk. 2) `density` — simpler numeric rule, lower risk, less often binding. 3) `lot_coverage` — lowest risk, least likely to be the real constraint.
**Default:** `parking`, pending reviewer confirmation the footnote structure is tractable on the first slice's timeline.
**Decider / Needed by / Blocks:** Domain reviewer / M3 / rules-engine category scope, `RuleCategory` enum in `03_data_model.md`.

### Q-04 — How should a parcel intersecting two zoning polygons be handled? *(covers A5)*
**Why:** If common, always routing to `verify_before_committing` makes the tool useless for a meaningful share of parcels in older, finer-grained parts of the city.
**What we know:** Not measured. The zoning layer (verified live) can answer this with one spatial query; nobody has run it yet.
**Options:** 1) Always route to verify, no matter the frequency — zero engineering, may be too conservative if common. 2) Query actual frequency first, then decide — cheap, removes the guess.
**Default:** Option 2.
**Decider / Needed by / Blocks:** Reviewer supplies frequency, Tarik decides on split-lot logic / M1 / parcel-resolution logic, rules-engine input contract.

### Q-05 — How are dimensional-table footnotes reviewed and applied? *(covers A7)*
**Why:** Footnotes (corner-lot, alley, adjacent-district exceptions) can flip a value; if ignored, a deterministic `pass` can be flatly wrong — the worst failure mode this product can have.
**What we know:** Footnotes exist (confirmed by reading the PDFs); their count and structure are not yet transcribed.
**Options:** 1) Every footnote on an approved table gets its own reviewed row — most correct, multiplies reviewer hours. 2) Only reviewer-flagged "commonly triggered" footnotes are modeled; the rest route affected parcels to verify — faster, keeps the gap visible instead of hidden.
**Default:** Option 2, matching the product's existing "visible unknown" pattern.
**Decider / Needed by / Blocks:** Domain reviewer / M2 / `table_footnotes` usage, M3 rule accuracy.

### Q-06 — Will pilot users accept "verify before committing" as a useful answer? *(covers A9)*
**Why:** The product's honesty (saying "needs a human" instead of guessing) is also its biggest adoption risk — it can read as a non-answer.
**What we know:** Untestable until real users see real output; PRD §9.5 already plans pilot questions aimed at this.
**Options:** 1) Wait for pilot feedback — no extra work, but a framing problem surfaces late. 2) User-test the verify screen and its "next action" copy with 2–3 target users before the pilot opens — cheap, catches it early.
**Default:** Option 2, using the demoable slice's memo as the test artifact.
**Decider / Needed by / Blocks:** Product (Tarik), via PRD §9.5 / M6 / pilot readiness, memo/UI copy.

### Q-07 — Do the comprehensive/area plans in `data/plans/` appear anywhere in v1 output?
**Why:** These 16 PDFs are policy context, never rules input (per `00_source_verification.md`) — the only question is whether they're worth surfacing as background reading.
**What we know:** Explicitly out of the rules engine and rule-category retrieval; a "policy context" section is flagged as a possible later milestone, not v1.
**Options:** 1) Fully out of v1, register only — zero incremental scope. 2) A small "related area plan" link on the memo — cheap, adds context.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tarik / M4 / retrieval corpus scope (low stakes either way).

### Q-08 — Does "analysis date" mean today, or a date the user picks?
**Why:** Determines whether a run's findings mean "as of right now" or "as of some future date the user is evaluating a deal against."
**What we know:** Runs are already immutable snapshots per `00_conventions.md`, which supports either answer — the gap is what date gets stamped, not the snapshot mechanism.
**Options:** 1) Always "as of now" — simplest, matches most preliminary-screen tools. 2) Let users pick a future date with a known-changes-only caveat — real added complexity (effective-date field) most pilot users may not need.
**Default:** Option 1 for v1.
**Decider / Needed by / Blocks:** Tarik / M1 / `feasibility_runs` semantics.

### Q-09 — What is the test address for the stacked-condo (multiple TAXKEYs, one point) case?
**Why:** ENG-02 requires an e2e test on a real stacked-condo address; the mechanism is confirmed live but engineering can't manufacture a real fixture.
**What we know:** Stacked polygons (one per TAXKEY) confirmed in the parcel layer's own description; no specific address supplied yet.
**Options:** 1) Reviewer supplies a known address — fastest, human-verified. 2) Engineering queries the layer for any point with >1 TAXKEY — no reviewer time, less curated.
**Default:** Option 2 to unblock now; swap in a reviewer address later if a better one is known.
**Decider / Needed by / Blocks:** Domain reviewer (or Tech lead) / M1 / ENG-02 test authoring.

---

## Data & sources

### Q-10 — What are the browser-confirmed official source URLs, and where does `city.milwaukee.gov/ZoningCode` redirect?
**Why:** Every citation needs an *active official source*; the ordinance PDF paths we have were never confirmed to load (Cloudflare blocks automated fetch), which is a risk to the product's core citation promise.
**What we know:** Verified live: all ArcGIS services, MPROP open data, Legistar amendments. Unverified: `ImageLibrary` PDF paths, the `ZoningCode` entry page and its redirect target, a possible changelog page. Local PDF content is verified even though the live URL isn't.
**Options:** 1) A human opens each URL once in a real browser, captures the final URL — minutes of work, fully resolves it. 2) Ship with best-guess URLs flagged internally as unverified, fix later — faster, risks a dead/wrong citation link reaching a pilot user.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tarik (or anyone with a browser) / M2 / ingestion, citation integrity product-wide.

### Q-11 — Does the zoning layer's district-code field join cleanly to Ch.295 codes? *(covers A4)*
**Why:** The rules engine needs the GIS `Zoning` field to match printed ordinance codes exactly; a mismatch (suffix, historic label, downtown variant) means every parcel needs a reviewed crosswalk table.
**What we know:** Both code sets exist and look similar in format; no actual sample has been diffed. Layer 12 ("downtown subdistricts") hints codes diverge somewhere (`C9x` variants).
**Options:** 1) Assume exact match, catch mismatches when M3 tests fail — fast, risks a silent wrong finding before tests exist. 2) Pull sample `Zoning` values for the chosen district(s) and diff against ordinance codes before M3 starts — an hour of work, removes the guess.
**Default:** Option 2, scoped only to the Q-01 district(s).
**Decider / Needed by / Blocks:** Data engineer + reviewer / M3 / district-matching logic.

### Q-12 — Can overlays and special districts be detected from GIS layers alone? *(covers A6)*
**Why:** The product's whole overlay approach is "detect via GIS, never interpret"; if some overlays exist only in ordinance text or map PDFs, the product would never even flag them as needing verification.
**What we know:** A substantial overlay/special-district layer set is verified live (DIZ, Interim Study, Lakefront, Master Sign, Neighborhood Conservation, SPROZ, Shoreland/Wetland, ARB, BID, Redevelopment, TID, historic districts, area plans). Completeness against Ch.295 subchapters 9–10 has not been checked.
**Options:** 1) Assume the current layer list is complete — no extra work, a real gap wouldn't surface until a live parcel hits it. 2) Cross-check the layer list against subchapters 9–10 before M2 locks the registry — one focused reading task.
**Default:** Option 2.
**Decider / Needed by / Blocks:** Reviewer + data engineer / M2 / `gis_layers` registry, verify-routing correctness.

### Q-13 — Which specific GIS layers are in v1 vs. detect-only?
**Why:** Without an explicit numbered list, "detect via GIS" scope silently grows or shrinks by developer judgment call.
**What we know (all verified live):** Parcels — layer 2. Zoning — layers 11, 12. DPD/GPD — 1, 2. Overlays — 4–10. Special districts — Redevelopment 6, TID 8. Historic — 17, 18, 23. Floodplain — 1, 2. This is the proposed v1 set, not yet reviewer-confirmed.
**Options:** 1) Accept the proposed set as-is — matches everything currently verified. 2) Trim historic-district layers to a later milestone since they're detect-only anyway — smaller M1 surface.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tech lead, reviewer sign-off on overlay/historic subset / M1 / `gis_layers` seed data.

### Q-14 — Which geocoder: `Locator/Address`, `LocatorV11/Top_1`, or `Locator/Taxkey`?
**Why:** Address search needs a specific geocoding service; which one the City's own tools use by default is explicitly unverified.
**What we know:** `Locator/Taxkey` confirmed live: single-line input, Geocode/ReverseGeocode/Suggest, min score 80, batch 1,000. `LocatorV11` exists but its production usage is unverified.
**Options:** 1) `Locator/Address` for address search, `Locator/Taxkey` for TAXKEY search — matches search mode by name, lowest surprise. 2) `LocatorV11/Top_1` — newer, unverified quality here.
**Default:** Option 1; test both against known addresses during M1, switch only if it underperforms.
**Decider / Needed by / Blocks:** Tech lead / M1 / ENG-01a implementation.

### Q-15 — What are the actual reuse terms for `milwaukeemaps` data and Ch.295 ordinance text?
**Why:** Narrower than Q-17 — this is what the terms *say*; Q-17 is what to do about it. Everything the product queries live (parcels, zoning, overlays) has unverified terms.
**What we know:** MPROP is verified CC-BY. `milwaukeemaps` terms-of-use page returns the same Cloudflare 403 as the ordinance PDFs; only a secondhand disclaimer snippet exists.
**Options:** 1) A human reads the terms page directly (same browser session as Q-10) — minutes, resolves it. 2) Assume public government data is generally reusable with attribution — faster, real legal risk once paying users are involved.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tarik, escalate to Legal if ambiguous / M2 / Q-17, attribution copy.

### Q-16 — How do we get around the Cloudflare block for monthly ordinance-source refresh?
**Why:** Without a repeatable refresh, citations silently go stale; subchapters carry "updated through" stamps from 2016 to late 2025.
**What we know:** Automated fetch to `city.milwaukee.gov` is blocked (confirmed, every attempt returned 403); a real browser is reported to work.
**Options:** 1) Human downloads monthly, drops in repo — zero engineering, a recurring chore that can get missed. 2) Browser-automation task on a schedule — more work, removes the human dependency but is inherently a bit fragile. 3) Ask the City Clerk for a non-Cloudflare feed — cleanest if it exists, depends entirely on the City offering one.
**Default:** Option 1 for v1; revisit 2 or 3 if refresh becomes a real burden.
**Decider / Needed by / Blocks:** Tarik / M2 / `worker-ts` refresh job design.

### Q-17 — May Milwaukee's GIS and ordinance content be stored, snapshotted, and shown to paying users? *(covers A10)*
**Why:** The evidence-viewer (PRD Z-02) depends on storing and re-displaying City content to paying users — this is a legal question, not a technical one.
**What we know:** Depends on Q-15's answer; municipal open-data terms aren't always written with SaaS resale in mind.
**Options:** 1) Proceed once Q-15 confirms permissive terms, no further review. 2) A short, scoped legal read even if terms look permissive — catches ambiguity a non-lawyer would miss.
**Default:** Option 2, paired with Q-30's legal touchpoint.
**Decider / Needed by / Blocks:** Tarik (legal check) / M0 / Q-15, pilot launch, evidence-viewer assumptions.

---

## Models & providers

### Q-18 — Which model, which API, and what data-retention terms for the briefing LLM?
**Why:** Cost, latency, and where client project data is processed all depend on this; relevant if pilot clients care about data residency.
**What we know:** `00_conventions.md` names `claude-fable-5-1` as recommended default, `sonnet-5` as a cheaper option, via the Anthropic API. No decision on Bedrock/Vertex.
**Options:** 1) Anthropic API + `claude-fable-5-1` — matches the stated default, fastest to integrate. 2) `sonnet-5` — cheaper, slightly less capable, worth it if Q-22 volume makes cost matter. 3) Bedrock/Vertex — only if a specific client contract requires data stay in their cloud boundary.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tarik + Tech lead / M5 / `briefing-llm` build.

### Q-19 — Embedding provider: OpenAI `text-embedding-3-large` or Voyage `voyage-3`?
**Why:** An embedding model turns ordinance text into numbers so retrieval can find semantically similar passages; versions can't be mixed within one index, so switching later means re-embedding the whole corpus.
**What we know:** Both named as options in `00_conventions.md`, no comparison done yet on legal text specifically.
**Options:** 1) OpenAI — widely used, easy to integrate. 2) Voyage — claimed stronger on domain/legal text, unverified for Ch.295 specifically.
**Default:** OpenAI to start; A/B against Voyage once the M6 gold set exists to measure against.
**Decider / Needed by / Blocks:** Tech lead / M4 / retrieval build, `embedding_versions` seed row.

### Q-20 — Reranker: hosted Cohere `rerank-v3.5`, or self-hosted `bge-reranker-v2-m3`?
**Why:** A reranker re-orders initial search results by relevance, directly affecting whether the right ordinance passage surfaces as evidence.
**What we know:** `00_conventions.md` names Cohere as default, `bge-reranker-v2-m3` as fallback/offline (Apache-2.0, confirmed no licensing blocker to self-hosting).
**Options:** 1) Cohere hosted — fastest, ongoing per-call cost. 2) Self-host — no per-call cost, needs a GPU/capable box and ops attention.
**Default:** Cohere hosted for the pilot's expected low volume (Q-22); revisit self-hosting if cost becomes material.
**Decider / Needed by / Blocks:** Tech lead / M4 / retrieval build.

### Q-21 — Is JEV access secured, is pricing acceptable, and which model version gets pinned?
**Why:** M5 shadow-mode work can't start without a key, and M6 evaluation results aren't comparable across runs if the model silently changes.
**What we know (verified live):** `POST api.typesafe.ai/v1/systemone`, bearer auth, response reports the exact version served (e.g. `jev-1.x.y`) even when `jev-latest` was requested. Pricing $0.042/M input tokens (early access). Limits 64k tokens/request, 1,200 req/min ("may change"). Not documented: determinism guarantee, seed, or calibration method.
**Options:** 1) Request access now, pin the returned version, re-pin deliberately on upgrade — matches the eval design's need for a fixed target. 2) Wait until M5 — risks approval delay right when it's needed.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tarik (account/pricing), Tech lead (integration) / M5 / `jev-client` integration, M6 comparability.

---

## Platform & ops

### Q-22 — What pilot volume should we design and price for?
**Why:** Screens/month, users, and seats drive JEV rate-limit sizing (Q-21), embedding/reranker/briefing-LLM cost, and infra sizing (Q-24).
**What we know:** Nothing — a business fact only Tarik has.
**Options:** 1) Small pilot (single-digit users, tens of screens/month) — cheapest, revisit if adoption is fast. 2) Design with headroom from day one — modest extra cost, avoids a scramble.
**Default:** Option 1 — pilots are small by definition; over-provisioning is the more common mistake.
**Decider / Needed by / Blocks:** Tarik / M0 / cost model, Q-24 sizing, Q-21 headroom.

### Q-23 — User authentication: Clerk, or Auth.js with email + Google?
**Why:** `00_conventions.md` requires organizations from day one, enforced by row-level security (a database feature keeping one tenant's rows invisible to another's queries) — the provider must model orgs/memberships natively.
**What we know:** Unresearched build choice; both are mature options for Next.js.
**Options:** 1) Clerk — orgs/memberships first-class, hosted UI ships faster, paid hosted dependency with its own data-residency terms. 2) Auth.js — no per-user cost, full control of where session data lives, but org/membership modeling is scope built by hand.
**Default:** Clerk — the org-from-day-one requirement is exactly what it's built for, and pilot-scale cost stays low.
**Decider / Needed by / Blocks:** Tech lead, budget sign-off from Tarik / M0 / app scaffolding, tenancy wiring.

### Q-24 — Deployment: Vercel + Fly/Railway + Neon, or a single Hetzner VPS with docker compose?

> **Answered (Tarik, 2026-09-21):** Vercel + Fly.io + Neon + R2. See `docs/decisions/008-deployment-shape.md`.
**Why:** Determines ops complexity, monthly cost, and how many services need patching and monitoring. Tarik already runs a Hetzner box.
**What we know:** `00_conventions.md`'s environments section already names the Vercel/Fly/Neon path as staging default. The Hetzner alternative isn't in any planning doc but is real infrastructure already in place.
**Options:** 1) Vercel + Fly/Railway + Neon — managed, less ops burden, scales without manual work, multiple vendor bills to watch. 2) Single Hetzner VPS — one box, one bill, already known, but manual patching/backup/scaling and a single point of failure unless mitigated.
**Default:** No safe default — this is the one platform question engineering cannot guess, since the two paths produce genuinely different infra code.
**Decider / Needed by / Blocks:** Tarik / M0 / CI/CD setup, all M0 infra work.

### Q-25 — Object storage: Cloudflare R2, S3, or Hetzner Object Storage?
**Why:** Every ingested PDF, page render, and memo export needs S3-compatible storage; couples naturally to Q-24's answer.
**What we know:** `00_conventions.md` names R2 as default, predating the Hetzner-VPS alternative.
**Options:** 1) R2 — zero egress fees, fits the current default, works regardless of where compute runs. 2) Hetzner Object Storage — simplest if Q-24 goes single-VPS. 3) S3 — most standard tooling, meaningful egress fees at this document volume.
**Default:** R2 if Q-24 goes managed; Hetzner Object Storage if Q-24 goes single-VPS — effectively resolved by Q-24.
**Decider / Needed by / Blocks:** Tech lead, following Q-24 / M0 / M2 ingestion pipeline.

### Q-26 — What is the retention policy for runs and audit events?
**Why:** `00_conventions.md` marks several tables append-only "except retention policy," implying one exists — but no duration or deletion rule has been set. Matters for storage cost at scale and any data-handling commitments to pilot users.
**What we know:** Nothing beyond the schema assuming a policy will exist eventually.
**Options:** 1) Keep everything indefinitely for the pilot (cheap at low volume), set a real policy later — fastest, defers the decision. 2) Set an explicit policy now — more upfront work, avoids retrofitting deletion into append-only tables later.
**Default:** Option 1 for the pilot; must be answered before any launch beyond it.
**Decider / Needed by / Blocks:** Tarik, Legal if users are external (Q-30) / M0 / `03_data_model.md` retention fields.

---

## Legal & pilot

### Q-27 — Who is the domain reviewer, and what does the role look like?

> **Status (Tarik, 2026-09-21):** no reviewer yet. Gold cases are being drafted by Claude as `unreviewed`; a reviewer corrects rather than authors.
**Why:** No rule can be reviewer-approved, no gold case authored, without a named human with allocated hours; right now "the reviewer" is a role in documents, not a person.
**What we know:** Nothing — a staffing fact only Tarik has.
**Options:** 1) One reviewer — simplest, cheapest, single point of failure, makes Q-28 unmeasurable (needs a pair). 2) Two reviewers — enables measuring agreement directly, redundant, doubles the recruiting/budget problem.
**Default:** Two if budget allows (Q-28 needs a pair); one is enough to unblock the first demoable slice.
**Decider / Needed by / Blocks:** Tarik (who, credentials, hours/week, paid) / M2 / M2/M3 rule approval, M6 gold-set authoring.

### Q-28 — How stable is reviewer agreement on gold-case labels? *(covers A8)*
**Why:** The gold set is the yardstick the eval dashboard measures against; if reviewers often disagree on the "right" conservative label, a metric like "85% route agreement" is measuring noise, not signal.
**What we know:** Unmeasurable until reviewers (Q-27) exist and have labeled a shared sample.
**Options:** 1) Have both reviewers independently label a small shared batch (10–15 cases) before the full 50-case gold set — cheap, direct answer. 2) Skip measuring, assume it's high enough — risks discovering an unreliable headline number at M6.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Reviewer pair (or reviewer + Tarik) / M6 / eval dashboard reliability, ENG-13 trustworthiness.

### Q-29 — What is the gold-case authoring format, and how is reviewer disagreement recorded?
**Why:** `gold_cases` is versioned in the schema, but its contents and what happens on reviewer disagreement aren't defined — silently picking one reviewer's answer would hide the exact disagreement Q-28 needs to see.
**What we know:** Only the table's existence and version/freeze behavior, from `00_conventions.md`.
**Options:** 1) Fixed template (inputs, expected finding per category, expected status/route, reviewer id, date) with disagreement recorded as a linked row, never overwritten — more upfront structure, makes disagreement queryable. 2) Free-form notes, reconciled informally — faster, loses the signal Q-28 needs.
**Default:** Option 1.
**Decider / Needed by / Blocks:** Tech lead + reviewer / M2 (start capturing cases early) / `gold_cases` schema usage, M6 dashboard.

### Q-30 — Are pilot users external, requiring a terms-of-service and disclaimer legal review?
**Why:** If pilot users are outside parties, the "preliminary screen, not a determination" disclaimer needs legal review — the exact wording that shields the product from a user treating `proceed_to_concept_design` as a guarantee.
**What we know:** Nothing — a business/legal fact only Tarik has.
**Options:** 1) Internal/friendly testers only, first round — no ToS/legal work yet, less representative feedback. 2) External users from the start — needs ToS/disclaimer review before M6, gets real market feedback sooner.
**Default:** Whichever matches the actual recruiting plan — not an engineering default to guess; flagged so it isn't discovered as a gap before launch.
**Decider / Needed by / Blocks:** Tarik, Legal for the language / M0 / pilot recruiting, M6 readiness, Q-17.

---

## Top 3 that block the first vertical slice

1. **Q-01 — which district.** Nothing else can be scoped (rules, test parcel, memo copy) until this is picked.
2. **Q-27 — who is the reviewer.** The slice's rules must be reviewer-approved by design; without a named person, M2's reviewer queue has nothing to queue for.
3. **Q-11 — does the GIS zoning code match the ordinance code for that district.** This is the join the rules engine needs to find the right rules for a real parcel; fast to check, but must happen before M3 rule-writing.

Everything else here can be defaulted, deferred, or answered in parallel without stalling the first slice.

## Decision log pointer

Every question above becomes a dated entry in `docs/decisions/` once answered (decision, why it came up, options with real costs, what was chosen and by whom, what was given up, how we'll know if it was right, and a field left blank for Tarik to fill in after the fact). `docs/LEARNING-LOG.md` gets a running entry for anything that turns out differently than expected once we know it.
