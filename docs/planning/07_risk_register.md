# 07. Risk register

## Purpose and how to read this

This register names, in plain English, the specific ways ParcelPilot could give someone a wrong or overconfident answer about whether a Milwaukee parcel can support what they want to build, or leak one client's project data to another. It exists so that every risk has a named owner, a concrete way to catch it if it happens, and a mitigation that points at an actual table, enum, or component in the system rather than a vague promise to "be careful." Anyone reviewing a milestone, writing a test, or building a dashboard panel should be able to open this file and know exactly what to check.

Each risk is scored as **Likelihood (1–5) × Impact (1–5) = Score**, where Likelihood is "how often would this happen if we did nothing extra about it" and Impact is "how bad is it when it does" — 5 being severe (real financial, legal, or trust harm) and 1 being a minor nuisance. Owners are listed as **roles**, not people, since the team will change: Product lead, Tech lead, Domain reviewer (planner/architect/zoning attorney), Data engineer, ML/eval engineer, Security owner, Ops owner. Every risk also names a detection signal — a metric, test, alert, or dashboard query that would actually catch the problem — because a mitigation nobody is watching is not a mitigation.

## Summary table

| ID | Area | Risk (one line) | L | I | Score | Owner role |
|---|---|---|---|---|---|---|
| R-LP-01 | Legal/product risk | User mistakes screen for legal advice | 3 | 5 | 15 | Product lead |
| R-LP-02 | Legal/product risk | Product copy drifts into "approved" language | 3 | 4 | 12 | Product lead |
| R-LP-03 | Legal/product risk | Screen or brief shared without preliminary-status framing | 3 | 3 | 9 | Product lead |
| R-LP-04 | Legal/product risk | Reviewer approves a rule_candidates entry without adequate scrutiny | 2 | 5 | 10 | Domain reviewer |
| R-SF-01 | Source freshness | A superseded ordinance stays active | 3 | 5 | 15 | Data engineer |
| R-SF-02 | Source freshness | A new amendment silently changes a table value | 3 | 5 | 15 | Data engineer |
| R-SF-03 | Source freshness | Official source URL/structure changes and refresh fails silently | 2 | 4 | 8 | Ops owner |
| R-SF-04 | Source freshness | Rule shown as active but effective date is in the future | 2 | 3 | 6 | Data engineer |
| R-PX-01 | PDF and table extraction | Footnote detached from table value | 3 | 4 | 12 | Data engineer |
| R-PX-02 | PDF and table extraction | OCR misreads a number | 3 | 5 | 15 | Data engineer |
| R-PX-03 | PDF and table extraction | Hierarchy detection mis-assigns a section to the wrong district | 3 | 4 | 12 | Domain reviewer |
| R-PX-04 | PDF and table extraction | Table extraction misaligns columns or rows | 3 | 4 | 12 | Data engineer |
| R-PX-05 | PDF and table extraction | Scanned/rotated page produces a garbled or empty chunk | 2 | 3 | 6 | Data engineer |
| R-GM-01 | GIS mismatches | Stacked condo TAXKEY ambiguity | 3 | 4 | 12 | Data engineer |
| R-GM-02 | GIS mismatches | Parcel polygon vs zoning polygon sliver overlaps | 3 | 4 | 12 | Data engineer |
| R-GM-03 | GIS mismatches | Zoning layer schema/field rename breaks mapping | 2 | 5 | 10 | Data engineer |
| R-GM-04 | GIS mismatches | ArcGIS service downtime or rate limits | 3 | 3 | 9 | Ops owner |
| R-TI-01 | Tenant isolation | Org A sees org B's project documents | 2 | 5 | 10 | Security owner |
| R-TI-02 | Tenant isolation | Worker service role bypasses RLS incorrectly | 2 | 5 | 10 | Security owner |
| R-TI-03 | Tenant isolation | Object storage key/prefix missing org scoping | 2 | 4 | 8 | Security owner |
| R-TI-04 | Tenant isolation | API route checks authentication but not org membership | 2 | 5 | 10 | Security owner |
| R-LJ-01 | LLM/JEV safety | JEV route more permissive than deterministic finding | 2 | 5 | 10 | Tech lead |
| R-LJ-02 | LLM/JEV safety | JEV nondeterminism across identical input | 3 | 3 | 9 | ML/eval engineer |
| R-LJ-03 | LLM/JEV safety | Briefing LLM invents a rule, changes status, or cites an inactive chunk | 3 | 5 | 15 | ML/eval engineer |
| R-LJ-04 | LLM/JEV safety | Prompt or schema version drift not logged | 3 | 3 | 9 | Tech lead |
| R-ED-01 | Evaluation design | Gold set too small or reviewer-disagreement collapsed to one label | 3 | 4 | 12 | ML/eval engineer |
| R-ED-02 | Evaluation design | Leakage of gold cases into prompt tuning | 3 | 4 | 12 | ML/eval engineer |
| R-ED-03 | Evaluation design | Gold set skewed toward easy cases | 3 | 4 | 12 | ML/eval engineer |
| R-ED-04 | Evaluation design | Same cases used for calibration and reported gate metrics | 2 | 4 | 8 | ML/eval engineer |
| R-OR-01 | Operational reliability | Latency p95 > 1s | 3 | 3 | 9 | Ops owner |
| R-OR-02 | Operational reliability | Queue backlog | 3 | 3 | 9 | Ops owner |
| R-OR-03 | Operational reliability | Embedding version mix in one index | 2 | 4 | 8 | Data engineer |
| R-OR-04 | Operational reliability | Cost blowup from rerank/LLM calls | 3 | 3 | 9 | Ops owner |

## Legal/product risk

#### R-LP-01 — User mistakes screen for legal advice
- **Risk:** A user treats a preliminary zoning screen as if it were a real zoning clearance and proceeds with a project on that basis.
- **Consequence:** Real financial or legal harm to the user, and reputational/liability exposure for ParcelPilot, on the exact failure mode the whole product exists to avoid.
- **Likelihood:** 3 — the product's core value proposition sits right next to "am I allowed to build this," so the temptation to over-read a result is constant.
- **Impact:** 5 — potential real-world harm and legal exposure.
- **Mitigation:** FinalStatus is always one of `proceed_to_concept_design | revise_scenario | verify_before_committing | insufficient_evidence`, never "approved" or "compliant"; a persistent "preliminary zoning screen — not an official zoning determination" banner appears on every scenario view and exported brief; validators reject any briefing_runs output that drifts into banned language before it renders.
- **Owner role:** Product lead
- **Detection signal:** Lint rule scanning UI strings and generated briefs for the banned phrase list (approved / by right / fully compliant / permitted / compliant) → blocks merge.
- **Residual risk:** A user can still misread a `verify_before_committing` result as good news without acting on the caveat; this is a UX/education risk that validation alone cannot close.

#### R-LP-02 — Product copy drifts into "approved" language
- **Risk:** A new UI string, marketing page, or fallback template introduces language implying an official clearance.
- **Consequence:** Same harm as R-LP-01, but introduced from inside the product rather than from user misreading.
- **Likelihood:** 3 — copy changes happen often across a growing product surface.
- **Impact:** 4 — reinforces the exact mistake the product must prevent, at scale.
- **Mitigation:** CI lint rule scans all UI strings and the briefing-llm's templated deterministic fallback text for the banned phrase list; validators independently reject any briefing_runs output containing those phrases, so this is a second, code-level backstop, not just a lint check.
- **Owner role:** Product lead
- **Detection signal:** Lint rule scanning UI strings and briefs for banned phrases → fails CI / blocks merge.
- **Residual risk:** The banned-phrase list is static; a new synonym ("cleared," "in the clear") could pass until someone adds it — needs periodic manual copy review.

#### R-LP-03 — Screen or brief shared without preliminary-status framing
- **Risk:** A user forwards a screenshot or excerpted PDF that crops out the caveat banner, and a third party (lender, contractor, buyer) treats it as definitive.
- **Consequence:** Downstream party makes a decision based on an unqualified fragment of the output.
- **Likelihood:** 3 — sharing partial screenshots is a normal user behavior, not an edge case.
- **Impact:** 3 — harm lands on a third party ParcelPilot has less ability to reach with corrective context.
- **Mitigation:** The preliminary-status banner and citation footer are embedded directly in every exported evidence package (see 7.5, "saved evidence package") as a non-removable footer/watermark, not only an on-screen banner.
- **Owner role:** Product lead
- **Detection signal:** Manual QA on every evidence-package export each release, confirming banner/footer presence.
- **Residual risk:** A user can still screenshot just the middle of a page; no technical control fully prevents misuse of a static document once it leaves the product.

#### R-LP-04 — Reviewer approves a rule_candidates entry without adequate scrutiny
- **Risk:** Time pressure leads a Domain reviewer to approve a `rule_candidates` row quickly, without verifying it against the source page image.
- **Consequence:** A wrong numeric threshold or misapplied rule enters `zoning_rules` as approved and propagates into every subsequent `feasibility_runs` that touches it.
- **Likelihood:** 2 — the review step exists specifically to prevent this, but pressure to move fast during a pilot is real.
- **Impact:** 5 — a bad approved rule silently corrupts every downstream finding until caught.
- **Mitigation:** Promotion to `zoning_rules` requires `ReviewStatus=approved` from a named Domain reviewer, recorded in `review_tasks`; `zoning_rules` is versioned (new version = new row), so a bad approval can be superseded without losing the audit trail of what was believed true and when.
- **Owner role:** Domain reviewer (planner/architect/zoning attorney)
- **Detection signal:** Dashboard query flagging `review_tasks` approved in under a set number of minutes from open, for spot-check.
- **Residual risk:** A careful, competent reviewer can still make a genuine judgment error; process reduces but cannot eliminate expert error.

## Source freshness

#### R-SF-01 — A superseded ordinance stays active
- **Risk:** A `source_documents` row that should flip to `SourceStatus=superseded` is not updated, and findings continue to be built against outdated law.
- **Consequence:** Every `zoning_rules` row and `feasibility_runs` depending on the stale source is quietly wrong.
- **Likelihood:** 3 — municipal code changes happen on a schedule ParcelPilot doesn't control and won't always be announced clearly.
- **Impact:** 5 — this is the single failure mode most likely to make the product confidently wrong.
- **Mitigation:** A scheduled `apps/worker` job re-fetches each active `source_documents` official URL and compares its SHA-256 hash; a hash change or a detected supersession notice flips `SourceStatus` and forces `ReviewStatus` back to review before any dependent `zoning_rules` can stay approved.
- **Owner role:** Data engineer
- **Detection signal:** "`source_documents` row with status=active whose official URL now returns a different SHA-256 → alert."
- **Residual risk:** Detection depends on the URL staying reachable and stable; a silent city-side change that doesn't alter the hash-visible content between refresh cycles can be missed.

#### R-SF-02 — A new amendment silently changes a table value
- **Risk:** A revised ordinance changes a number in a `source_tables` cell (e.g., a setback), but the change isn't surfaced for review.
- **Consequence:** An approved `zoning_rules` row keeps an outdated numeric threshold after the law has changed.
- **Likelihood:** 3 — amendments to specific numeric standards are a normal, ongoing occurrence.
- **Impact:** 5 — directly corrupts the numeric findings the rules-engine exists to get right.
- **Mitigation:** On any hash change, `worker-py` re-parses and diffs the new `source_tables` against the prior version; any changed cell opens a `rule_candidates` entry requiring Domain reviewer approval before `zoning_rules` updates, and the prior version is retained (append-only) for audit.
- **Owner role:** Data engineer
- **Detection signal:** Automated diff of `source_tables` values across `document_pages` versions on refresh; a non-empty diff opens a `review_tasks` item, tracked on a dashboard of open diff-review tasks.
- **Residual risk:** A value change inside an image-only region that OCR fails to extract cleanly could be missed by the text diff.

#### R-SF-03 — Official source URL or structure changes and refresh fails silently
- **Risk:** The city's site restructures or the fetch errors out, and the failure isn't surfaced, so `source_documents` quietly stops updating while still appearing current.
- **Consequence:** Stale data is served as if it were fresh, with no visible signal that anything is wrong.
- **Likelihood:** 2 — less frequent than routine amendments, but government sites do get redesigned.
- **Impact:** 4 — undermines the freshness guarantee the whole source registry exists to provide.
- **Mitigation:** Every refresh attempt logs a `RunStatus` tied to `audit_events`; a failed or errored fetch (`RunStatus=failed`) triggers an alert instead of being swallowed.
- **Owner role:** Ops owner
- **Detection signal:** Alert on any source-refresh `RunStatus=failed`, or on a `source_documents` row with no successful refresh in N days.
- **Residual risk:** A fetch that "succeeds" but returns the wrong content (e.g., a redesigned landing page instead of the PDF) needs a content-shape check as a secondary defense, which is not guaranteed to catch every case.

#### R-SF-04 — Rule shown as active but effective date is in the future
- **Risk:** An adopted amendment is entered before its legal effective date, and a scenario is screened against a rule not yet in force.
- **Consequence:** A technically-later-but-wrong-today finding is shown as current.
- **Likelihood:** 2 — this depends on catching amendments early, which is uncommon but possible during active legislative review.
- **Impact:** 3 — misleading but self-correcting once the effective date passes.
- **Mitigation:** `zoning_rules` carries an effective date; the rules-engine only evaluates `ApprovedRule[]` where the effective date is on or before the scenario run date, and surfaces a note when a future-effective rule exists that would change the outcome.
- **Owner role:** Data engineer
- **Detection signal:** Gold-set test asserting a future-dated rule is excluded from `calculations` for a present-day `feasibility_runs`.
- **Residual risk:** Depends on the effective date being populated correctly at approval time; a missing or wrong date defeats the safeguard.

## PDF and table extraction

#### R-PX-01 — Footnote detached from table value
- **Risk:** A `source_tables` value carries an exception or condition recorded in `table_footnotes`, but the link between them breaks during parsing.
- **Consequence:** The rules-engine applies the raw number without its qualifier — for example, a setback that is actually reduced near an alley or corner lot.
- **Likelihood:** 3 — footnote markers are exactly the kind of visual detail automated table parsing tends to drop.
- **Impact:** 4 — produces a wrong finding that looks fully sourced.
- **Mitigation:** The `worker-py` parsing pipeline preserves a positional link between each `source_tables` cell and any `table_footnotes` on the same `document_pages`; Domain reviewer sign-off on every `rule_candidates` entry requires confirming footnote linkage against the preserved original page image before promotion to `zoning_rules`.
- **Owner role:** Data engineer
- **Detection signal:** Gold-set test case with a known footnoted value, asserting the footnote link survives parsing; reviewer checklist item.
- **Residual risk:** An unusual footnote marker style the parser doesn't recognize can still be missed on first pass, relying on the reviewer to catch it against the page image.

#### R-PX-02 — OCR misreads a number
- **Risk:** Optical character recognition transcribes a digit incorrectly (e.g., "25" read as "23").
- **Consequence:** A wrong `zoning_rules` threshold enters the system and produces a wrong `FindingStatus` downstream.
- **Likelihood:** 3 — scanned municipal PDFs vary widely in print quality, and digit transposition is a known OCR failure mode.
- **Impact:** 5 — a single misread digit corrupts a numeric finding that a user may rely on directly.
- **Mitigation:** OCR output is never auto-promoted; every `rule_candidates` numeric value requires Domain reviewer confirmation against the preserved source page image before it becomes an approved `zoning_rules`; `gold_cases` include known-value spot checks.
- **Owner role:** Data engineer
- **Detection signal:** Gold-set numeric-accuracy test comparing extracted values to hand-verified values; `review_tasks` requires an explicit "value confirmed against source image" step before approval is recorded.
- **Residual risk:** Human reviewers can also misread a low-resolution scan; residual risk is bounded by review quality, not eliminated.

#### R-PX-03 — Hierarchy detection mis-assigns a section to the wrong district
- **Risk:** Parsing attaches a subchapter's rule to the wrong district — for example, a rule meant for RM-family districts gets applied to an NS/LB-family scenario.
- **Consequence:** A finding is generated against the wrong district's standards entirely.
- **Likelihood:** 3 — Chapter 295's chapter/subchapter/district structure is exactly the kind of nested hierarchy automated parsing gets wrong.
- **Impact:** 4 — the finding is wrong for a structural reason, not a numeric one, and can be harder to spot on review.
- **Mitigation:** `code_sections` hierarchy is re-verified by a Domain reviewer per candidate district before promotion; `rule_citations` always ties a `zoning_rules` row back to the exact `code_sections`/`code_chunks` it came from, so a reviewer can trace and catch a mis-assignment before approval.
- **Owner role:** Domain reviewer (planner/architect/zoning attorney)
- **Detection signal:** Gold-set test with known district-to-section mappings for the v1 "2–4 TBD by reviewer" districts; review checklist requires confirming district match before approval.
- **Residual risk:** An edge case in Milwaukee's code structure (a shared or cross-referenced subchapter) may not surface until a real scenario hits it.

#### R-PX-04 — Table extraction misaligns columns or rows
- **Risk:** The table parser (Camelot) merges or shifts a row/column boundary, silently swapping which value applies to which `RuleCategory` (e.g., front and side setback swapped).
- **Consequence:** A finding cites the wrong number for the right-sounding category.
- **Likelihood:** 3 — dense zoning tables with merged headers are a known weak point for table-extraction libraries.
- **Impact:** 4 — the error is invisible unless someone checks the table shape against the source image.
- **Mitigation:** Parsed `source_tables` output is rendered back against the original page image in `review-ui` so a Domain reviewer visually confirms column/row alignment before any `rule_candidates` is approved.
- **Owner role:** Data engineer
- **Detection signal:** Gold-set test comparing parsed table shape (row/column count and header labels) to expected structure for known tables; mismatch fails the test.
- **Residual risk:** An unusually laid-out table (merged header cells, nested sub-tables) may still misalign in ways a quick visual check misses.

#### R-PX-05 — Scanned or rotated page produces a garbled or empty chunk
- **Risk:** A poorly scanned or rotated page yields a near-empty or garbled `code_chunks` after OCR.
- **Consequence:** Retrieval finds no usable evidence for a district that does have applicable text, so the system reports `insufficient_evidence` when evidence actually exists — understating coverage rather than overstating it.
- **Likelihood:** 2 — most source PDFs are clean, but scanned amendments and older documents are more variable.
- **Impact:** 3 — a false "no evidence" is safer than a false positive, but still degrades usefulness and coverage.
- **Mitigation:** The `worker-py` pipeline flags `document_pages` with OCR confidence below a threshold or near-empty extracted text, routing them to a `review_tasks` item for manual re-scan or transcription instead of silently indexing empty chunks.
- **Owner role:** Data engineer
- **Detection signal:** Dashboard count of `document_pages` with OCR confidence below threshold or `code_chunks` with near-zero token count, queued for review.
- **Residual risk:** A page that OCRs "successfully" but with subtly wrong characters (not empty, not flagged low-confidence) can still pass this check.

## GIS mismatches

#### R-GM-01 — Stacked condo TAXKEY ambiguity
- **Risk:** One physical address maps to multiple TAXKEYs (condo units), and the wrong one is selected.
- **Consequence:** Zoning and geometry data for the wrong unit, or a shared-parcel record, is used for the scenario.
- **Likelihood:** 3 — stacked condos are common enough in Milwaukee's parcel data to be a routine occurrence, not an edge case.
- **Impact:** 4 — can produce a materially wrong parcel context for the entire scenario.
- **Mitigation:** Parcel selection requires explicit TAXKEY confirmation whenever a GIS lookup returns more than one candidate for an address; `parcel_snapshots` records exactly which TAXKEY and geometry was used for a scenario run, making it auditable afterward.
- **Owner role:** Data engineer
- **Detection signal:** Gold-set test with a known stacked-condo address, asserting the UI surfaces multiple TAXKEY candidates rather than silently picking one.
- **Residual risk:** If the city's own GIS data has the condo units mis-mapped, confirmation UI surfaces the ambiguity but cannot fix bad source data.

#### R-GM-02 — Parcel polygon vs zoning polygon sliver overlaps
- **Risk:** A small edge mismatch between parcel and zoning-layer polygons makes a parcel appear to touch two districts, or a genuinely split parcel is treated as single-district.
- **Consequence:** A borderline or split-lot scenario is screened as if it sat cleanly in one district.
- **Likelihood:** 3 — polygon layers from different sources rarely align perfectly at shared boundaries.
- **Impact:** 4 — a wrong single-district assumption changes every downstream rule lookup.
- **Mitigation:** `gis_intersections` computes overlap area/percentage for every parcel-vs-zoning-layer intersection, not just a point-in-polygon test; any parcel with two or more districts above a materiality threshold forces `FinalStatus=verify_before_committing`, per PRD 8.6 rule 3 (material unreviewed condition).
- **Owner role:** Data engineer
- **Detection signal:** `gis_intersections` row with 2+ districts each above the materiality threshold for one parcel routes to `verify_before_committing`; dashboard count of multi-district parcels per week.
- **Residual risk:** The materiality threshold is a judgment call; a genuinely split parcel just above or below it can still be borderline.

#### R-GM-03 — Zoning layer schema or field rename breaks mapping
- **Risk:** Milwaukee's ArcGIS service renames or restructures a field (e.g., the district-code field), and ingestion either fails or silently maps to the wrong field.
- **Consequence:** Every downstream `gis_intersections` computed after the rename is corrupted until caught.
- **Likelihood:** 2 — infrequent, but external GIS services do get restructured without notice to consumers.
- **Impact:** 5 — a silent field-mapping error would be hard to notice and would poison every parcel lookup until found.
- **Mitigation:** The `apps/worker` GIS refresh validates the incoming schema against the registered `gis_layers` field mapping before writing a new `gis_layer_snapshots`; a mismatch halts the refresh and raises an alert instead of ingesting under the stale mapping.
- **Owner role:** Data engineer
- **Detection signal:** Schema-validation failure on `gis_layers` refresh → alert; refresh job `RunStatus=failed` with schema diff attached.
- **Residual risk:** A rename that reuses a plausible-looking field name (rather than removing a field outright) could pass validation but carry different values, requiring a periodic spot-check against known parcels.

#### R-GM-04 — ArcGIS service downtime or rate limits
- **Risk:** Scheduled GIS refresh jobs fail or get throttled, or a live parcel lookup fails mid-session.
- **Consequence:** `gis_layer_snapshots` goes stale beyond the expected freshness window, or a user hits a failure during scenario creation.
- **Likelihood:** 3 — third-party government API availability is outside ParcelPilot's control and does fluctuate.
- **Impact:** 3 — degrades the experience and freshness but doesn't itself corrupt existing data.
- **Mitigation:** `apps/worker` GIS refresh uses backoff/retry within rate limits and falls back to the last successful `gis_layer_snapshots` (with its snapshot date surfaced to the user) rather than blocking the workflow; a live-lookup failure shows "GIS temporarily unavailable, using data as of [date]" instead of failing silently.
- **Owner role:** Ops owner
- **Detection signal:** Alert on a GIS refresh `RunStatus=failed` streak or on ArcGIS API error-rate threshold; dashboard showing `gis_layer_snapshots` age.
- **Residual risk:** An extended outage still means users see aging data; no fallback can conjure fresher data than the source provides.

## Tenant isolation

#### R-TI-01 — Org A sees org B's project documents
- **Risk:** A query, route, or misconfiguration returns one organization's `projects`/`scenarios` data to a user from another organization.
- **Consequence:** A serious confidentiality breach on client project data — a trust-ending failure for a product built on the promise that project/client documents never cross org boundaries.
- **Likelihood:** 2 — row-level security and route-level checks are both designed specifically to prevent this, but multi-tenant data leaks are a recurring class of production bug industry-wide.
- **Impact:** 5 — breaches the core tenant-isolation promise in the product boundaries.
- **Mitigation:** The database enforces row-level security (RLS) on all tenant-scoped tables (`projects`, `scenarios`, and their descendants) keyed to `organizations` via `memberships`; `api` route handlers never bypass RLS with a service role for user-facing reads — only `apps/worker`/`worker-py` background jobs use a service role, and only for their own scoped writes.
- **Owner role:** Security owner
- **Detection signal:** "RLS test failing" — a CI test suite attempting cross-org reads for every tenant-scoped table, asserting zero rows returned, blocks merge on failure.
- **Residual risk:** A future migration that adds a new tenant-scoped table without enabling RLS is a process risk, not something existing tests can catch — needs a standing checklist.

#### R-TI-02 — Worker service role bypasses RLS incorrectly
- **Risk:** `apps/worker` or `worker-py`, which legitimately need elevated access for background jobs, reads or writes across organizations because a query is missing an explicit `org_id` filter.
- **Consequence:** The same cross-tenant exposure as R-TI-01, but originating from a background job rather than a user-facing request.
- **Likelihood:** 2 — background jobs are lower-traffic code paths that get less day-to-day scrutiny than API routes.
- **Impact:** 5 — service-role queries bypass RLS by design, so a missing filter has no automatic backstop.
- **Mitigation:** Every worker job is scoped by an explicit `org_id`/`project_id` parameter passed at job enqueue time (pg-boss job payload); worker queries always filter by it explicitly rather than relying on RLS alone.
- **Owner role:** Security owner
- **Detection signal:** RLS/authorization test suite includes worker-path tests (not just API-path tests), asserting a job scoped to org A cannot read or write org B rows; code review checklist item for any new worker query.
- **Residual risk:** A newly added worker job type that forgets explicit scoping is a code-review-dependent risk until it has its own automated test.

#### R-TI-03 — Object storage key/prefix missing org scoping
- **Risk:** A document's object storage key or signed URL is improperly namespaced, letting one org's uploaded document be fetched by another org.
- **Consequence:** Direct file-level cross-tenant exposure, bypassing the database layer entirely.
- **Likelihood:** 2 — object storage layout is set once and rarely touched, but it's easy to get wrong the first time.
- **Impact:** 4 — a leaked document is a real breach, though narrower in scope than a full data-layer leak.
- **Mitigation:** All tenant-scoped object storage keys are namespaced by `org_id` and `project_id` as a mandatory prefix; signed URLs are short-lived and generated only after an `api` route handler confirms membership.
- **Owner role:** Security owner
- **Detection signal:** Automated test attempting to construct or guess a cross-org object key/URL and confirming access denial; periodic audit of the bucket key structure.
- **Residual risk:** A long-lived or improperly scoped signed URL, if ever generated by mistake, could still be shared or leaked outside the intended session.

#### R-TI-04 — API route checks authentication but not organization membership
- **Risk:** A route handler confirms "is this user logged in" but not "is this user a member of this project's organization" before returning data for a resource ID.
- **Consequence:** A logged-in user from org A can request an org B resource ID directly and receive org B's data.
- **Likelihood:** 2 — a well-known class of authorization bug, mitigated by RLS as a second layer, but still possible in a new or hastily written route.
- **Impact:** 5 — same severity as R-TI-01, from a different code path.
- **Mitigation:** Every `api` route handler that accepts a resource ID (project, scenario, parcel) re-derives the organization from `memberships` and the resource itself, and checks membership before querying, in addition to RLS as a second layer of defense.
- **Owner role:** Security owner
- **Detection signal:** Authorization test suite hits every tenant-scoped `api` route with a valid session for org A and a resource ID from org B, asserting a 403/404, not data; new-route checklist requires this test before merge.
- **Residual risk:** A newly added route not yet covered by the authorization test suite is exposed until the suite catches up — process discipline, not a guaranteed backstop.

## LLM/JEV safety

#### R-LJ-01 — JEV route more permissive than deterministic finding
- **Risk:** `jev-client` returns a `JevRoute` like `proceed_to_concept_design` when the deterministic rules-engine already produced a critical fail or a material unreviewed condition.
- **Consequence:** The user is told a genuinely risky scenario looks clear.
- **Likelihood:** 2 — this is exactly the failure mode the architecture's hard-override design exists to prevent, but any model-based component can drift toward optimism.
- **Impact:** 5 — a false "proceed" is the single most damaging output the product can produce.
- **Mitigation:** PRD 8.6's hard overrides are enforced as a deterministic policy function that runs after `jev_runs` and before `FinalStatus` is set; a critical fail, missing citation, unreviewed material condition, or low-confidence JEV output always forces the safer `FinalStatus` regardless of what `JevRoute`/`JevRisk` returned — final status can never be more permissive than the strictest deterministic finding or policy flag.
- **Owner role:** Tech lead
- **Detection signal:** "Unsafe permissive route rate > 0 on gold set in CI → block merge" — a gold-set test asserting `FinalStatus` is never more permissive than the corresponding deterministic `Finding[]`/`Criticality` for every `gold_cases` scenario, run on every rules-engine or policy-function change.
- **Residual risk:** The override rules are only as complete as PRD 8.6's enumerated cases; a new failure mode not yet captured as a hard override could slip through until the gold set catches it.

#### R-LJ-02 — JEV nondeterminism across identical input
- **Risk:** The same `PreparedDecisionState` (same input hash) produces a different `JevDecision` on two separate runs.
- **Consequence:** Undermines trust in the decision layer and makes the 9.4 stability metric unreliable to report.
- **Likelihood:** 3 — some variance is expected from a third-party model API; the PRD itself treats this as measurable, not guaranteed-zero.
- **Impact:** 3 — a shadow-mode rollout limits real-world harm while this is measured.
- **Mitigation:** `jev_runs` logs the input state hash alongside the `JevDecision` and any response probabilities/confidence for every call; repeat-route consistency is measured against the 9.4 launch gate; `DecisionMode=shadow` runs JEV without it affecting `FinalStatus`, so instability is caught before JEV is load-bearing.
- **Owner role:** ML/eval engineer
- **Detection signal:** Scheduled job re-submitting a fixed set of frozen `PreparedDecisionState` hashes to `jev-client` and diffing `JevDecision` output over time; variance above documented tolerance → alert, per the 9.4 stability gate.
- **Residual risk:** Some variance is inherent to the provider and, per the PRD's own language, is "measured and documented," not eliminated.

#### R-LJ-03 — Briefing LLM invents a rule, changes status, or cites an inactive chunk
- **Risk:** `briefing-llm` generates prose stating a rule not present in the approved `zoning_rules`, restates `FinalStatus` differently than what was locked, or cites a `code_chunks`/`source_documents` no longer `SourceStatus=active`.
- **Consequence:** A direct violation of the controlled evidence chain — the exact thing that makes an LLM-generated brief trustworthy or not.
- **Likelihood:** 3 — hallucination and paraphrase drift are known failure modes for any generative step, even a schema-constrained one.
- **Impact:** 5 — an invented rule or a mismatched status, delivered in fluent prose, is more dangerous than an obviously broken output because it reads as authoritative.
- **Mitigation:** `briefing-llm` only runs after status is locked, receiving the frozen briefing contract as input and producing schema-constrained JSON; `validation_runs` rejects any `briefing_runs` output whose status differs from `feasibility_runs.final_status`, whose citations reference an inactive `SourceStatus`, or whose claims aren't traceable to the frozen contract; on rejection, the product falls back to a templated deterministic brief instead of displaying unvalidated LLM output.
- **Owner role:** ML/eval engineer
- **Detection signal:** "Briefing validator rejection rate > 5% over 24h" dashboard alert; citation-precision and unsupported-claim-rate metrics tracked per `briefing_runs`.
- **Residual risk:** A validator can catch a fabricated citation or a status mismatch, but a subtly misleading paraphrase that stays within the allowed facts and citations is harder to catch automatically and needs ongoing eval-set coverage.

#### R-LJ-04 — Prompt or schema version drift not logged
- **Risk:** The briefing prompt template or output JSON schema changes without a recorded version.
- **Consequence:** Impossible to reproduce or debug why an older `briefing_runs` behaved differently, and evaluation metrics can't be attributed to a specific version.
- **Likelihood:** 3 — prompt iteration is expected and frequent during development and tuning.
- **Impact:** 3 — a debugging and evaluation-integrity problem, not a direct user-facing safety failure.
- **Mitigation:** Every `jev_runs` and `briefing_runs` row records the prompt/schema version and model id used, alongside `embedding_versions` for any `retrieval_runs` it depended on, following the same "never mix versions" discipline as embeddings; observability traces link a run back to its exact configuration.
- **Owner role:** Tech lead
- **Detection signal:** CI check or startup assertion that every `jev_runs`/`briefing_runs` write includes a non-null prompt/schema version field; dashboard query flagging any run missing version metadata.
- **Residual risk:** Version logging prevents "we don't know what ran," but doesn't by itself prevent a bad new version from being promoted — that depends on the evaluation gates below.

## Evaluation design

#### R-ED-01 — Gold set too small or reviewer-disagreement collapsed to one label
- **Risk:** `gold_cases` has too few examples per `RuleCategory`/district/overlay combination to make the 9.4 recall/agreement/calibration gates statistically meaningful, and disagreement between reviewers is silently resolved to a single label.
- **Consequence:** Launch-gate metrics look solid while hiding genuine ambiguity that JEV should actually be measured against.
- **Likelihood:** 3 — building a well-distributed 50-case gold set under time pressure is genuinely hard.
- **Impact:** 4 — an unreliable evaluation set undermines every downstream safety and quality claim in 9.4.
- **Mitigation:** `gold_cases` records each reviewer's independent label plus the resolution method (not just a final collapsed label), via its version column and immutability-after-freeze discipline; the M6 milestone explicitly targets a gold set of 50 with a minimum count per `RuleCategory`/`JevRoute` combination before evaluation gates are treated as final.
- **Owner role:** ML/eval engineer
- **Detection signal:** Dashboard query counting `gold_cases` per `RuleCategory`/`JevRoute` cell, flagging any cell below a minimum threshold; report of reviewer-disagreement rate, not just a single collapsed accuracy number.
- **Residual risk:** 50 cases is still a small sample for rare categories (e.g., overlays); some metrics will carry wide confidence intervals that the pilot has to treat as such.

#### R-ED-02 — Leakage of gold cases into prompt tuning
- **Risk:** Someone iterating on the briefing-llm prompt or `jev-client` question design uses `gold_cases` examples directly, inflating measured performance without real generalization.
- **Consequence:** Reported 9.4 launch-gate metrics look better than true real-world performance.
- **Likelihood:** 3 — the gold set is the most convenient set of realistic examples on hand, which is exactly what makes leakage tempting during iteration.
- **Impact:** 4 — a leaked evaluation set produces a false sense of safety on the metrics that gate production launch.
- **Mitigation:** `gold_cases` is split into a tuning subset and a held-out reporting subset before any prompt or threshold work begins, tracked via the version column; only the held-out subset's results are used for the 9.4 launch-gate numbers, and the split is documented in the evaluation dashboard.
- **Owner role:** ML/eval engineer
- **Detection signal:** Log of which `gold_cases` IDs were referenced during prompt/threshold development sessions, checked against the held-out set for overlap; any overlap found in a launch-gate report blocks the gate.
- **Residual risk:** Even with a formal split, a developer's general familiarity with "the kinds of cases in the gold set" is a softer form of leakage that process alone can't fully prevent.

#### R-ED-03 — Gold set skewed toward easy cases
- **Risk:** `gold_cases` overrepresents clear-cut pass/fail scenarios and underrepresents overlays, special districts, or `insufficient_evidence` cases.
- **Consequence:** 9.4 metrics look strong while the product is actually weakest exactly where JEV's judgment matters most.
- **Likelihood:** 3 — easy, clean cases are simply easier to source and label than genuinely ambiguous ones.
- **Impact:** 4 — a skewed gold set hides the risk profile that matters most for a launch decision.
- **Mitigation:** `gold_cases` construction explicitly requires a minimum share of overlay/special-district scenarios and each `FinalStatus`/`JevRoute` value (not just proceed/revise), reviewed by a Domain reviewer for representativeness before the M6 evaluation dashboard is treated as pilot-ready.
- **Owner role:** ML/eval engineer
- **Detection signal:** Dashboard breakdown of `gold_cases` by `FinalStatus` and by presence/absence of an overlay flag, checked against a minimum-coverage target before sign-off.
- **Residual risk:** "Representative" is a judgment call; a genuinely rare real-world edge case can still be underrepresented no matter how careful the construction.

#### R-ED-04 — Same cases used for calibration and reported gate metrics
- **Risk:** The confidence threshold used to route low-confidence JEV outputs to a safer action (PRD 8.6 rule 5) is calibrated on the same cases used to report the 9.4 calibration/safety metrics.
- **Consequence:** Reported calibration numbers are optimistic by construction.
- **Likelihood:** 2 — a subtler form of the same leakage pressure as R-ED-02, but easier to avoid once the tuning/held-out split exists.
- **Impact:** 4 — an inflated calibration claim directly undermines the "no unvalidated confidence threshold in production" requirement in 9.4.
- **Mitigation:** The calibration threshold is fit only on the tuning subset of `gold_cases` (same split as R-ED-02) and then evaluated, unmodified, against the held-out reporting subset for the actual 9.4 launch-gate numbers.
- **Owner role:** ML/eval engineer
- **Detection signal:** Evaluation dashboard explicitly labels which `gold_cases` subset produced the calibration threshold versus which subset produced the reported metric, so the split is auditable at a glance.
- **Residual risk:** With only 50 total gold cases at the M6 target, splitting further into tuning/held-out shrinks each subset, trading leakage risk for statistical power — a real tradeoff, not a free fix.

## Operational reliability

#### R-OR-01 — Latency p95 > 1s
- **Risk:** The decision layer (`jev-client` plus the policy function) misses the 9.4 performance gate of p95 at or below one second for a standard prepared state.
- **Consequence:** Degrades the demo/pilot experience and may mask a deeper architectural bottleneck.
- **Likelihood:** 3 — a third-party API call in the critical path is inherently variable.
- **Impact:** 3 — a usability and trust issue rather than a correctness issue.
- **Mitigation:** Observability (OpenTelemetry traces) instruments every `jev_runs` call and the surrounding policy function separately, so a regression can be attributed to the JEV API itself versus ParcelPilot's own processing; `jev-client` is feature-flagged via `DecisionMode` so it can be reverted to `rules_only` if latency regresses in production.
- **Owner role:** Ops owner
- **Detection signal:** Grafana/Metabase eval dashboard panel tracking decision-layer p95 latency over time, alerting when it exceeds the 1s gate for a sustained window.
- **Residual risk:** Some latency sits outside ParcelPilot's control (the third-party JEV API's own response time); the `rules_only` fallback limits user impact but doesn't fix the underlying dependency's speed.

#### R-OR-02 — Queue backlog
- **Risk:** The `apps/worker` pg-boss queue (GIS refresh, retrieval, JEV, briefing, evaluation jobs) backs up under load.
- **Consequence:** Delayed scenario results, and potentially stale GIS data if refresh jobs get stuck behind other work.
- **Likelihood:** 3 — any shared job queue is vulnerable to backlog once traffic or job volume grows past what was tested.
- **Impact:** 3 — a usability and freshness issue, contained by fallbacks elsewhere in the register.
- **Mitigation:** pg-boss job types are prioritized (interactive scenario-run jobs ahead of background GIS refresh/evaluation jobs); observability tracks queue depth and the age of the oldest queued job per job type, not just overall throughput.
- **Owner role:** Ops owner
- **Detection signal:** Dashboard alert on pg-boss queue depth or oldest-job-age exceeding a threshold per job type.
- **Residual risk:** A sustained spike beyond provisioned worker capacity still causes delay; prioritization shifts who waits, it doesn't create capacity.

#### R-OR-03 — Embedding version mix in one index
- **Risk:** Vectors from two different `embedding_versions` (e.g., after switching embedding models) end up mixed in the same pgvector index.
- **Consequence:** Meaningless similarity scores and degraded or wrong `retrieval_evidence`.
- **Likelihood:** 2 — only happens around a deliberate embedding-model change, which is an infrequent, plannable event.
- **Impact:** 4 — silently degraded retrieval quality is hard to notice without a dedicated check.
- **Mitigation:** `embedding_versions` is recorded per `code_chunks` embedding row, and retrieval queries are always scoped to a single `embedding_versions` value; a version change triggers a full re-embed of affected `code_chunks` into a new index rather than an in-place mixed update, per the conventions doc's explicit "never mix versions in one index" rule.
- **Owner role:** Data engineer
- **Detection signal:** Startup/CI assertion or periodic query checking that every vector in a given retrieval index shares one `embedding_versions` value; alert on any mismatch found.
- **Residual risk:** A re-embed job interrupted partway could momentarily leave a mixed state until the check above catches and blocks it from being queried.

#### R-OR-04 — Cost blowup from rerank/LLM calls
- **Risk:** Reranker (Cohere rerank-v3.5) and `briefing-llm` (Claude) calls scale with usage in a way that isn't monitored.
- **Consequence:** A pilot with more traffic than expected, or a retry-loop bug, produces a surprise bill or forces throttling that degrades the product mid-pilot.
- **Likelihood:** 3 — usage-based model costs are easy to underestimate before real pilot traffic arrives.
- **Impact:** 3 — a budget and continuity risk rather than a correctness or safety risk.
- **Mitigation:** Observability traces record token/call counts and estimated cost per `retrieval_runs`, `jev_runs`, and `briefing_runs`; the 9.4 "cost per completed screen" metric is tracked continuously with a budget alert threshold, and the local bge-reranker-v2-m3 fallback is available to cut reranker cost if hosted Cohere cost spikes.
- **Owner role:** Ops owner
- **Detection signal:** Dashboard panel tracking daily/weekly cost per completed screen against budget; alert when a rolling window exceeds a set multiple of the expected baseline.
- **Residual risk:** A sudden legitimate traffic spike (successful pilot expansion) still costs more in absolute terms; the alert catches anomalies, not intended growth, so a human still has to tell the two apart.

## Top 5 risks right now

These five all score 15 (Likelihood 3 × Impact 5), the highest in the register, and each sits directly on the product's core safety promise rather than on a peripheral feature.

1. **R-LP-01 — User mistakes screen for legal advice.** This is the failure mode the entire product boundary (preliminary screen, never "approved") exists to prevent, and it's the one hardest to close with code alone — it depends on UX discipline holding up under real user behavior, not just validators.
2. **R-SF-01 — A superseded ordinance stays active.** If source freshness silently fails, every downstream layer (rules, JEV, briefing) inherits the error while behaving as if everything is correct — this is the risk most likely to make the whole system confidently wrong.
3. **R-SF-02 — A new amendment silently changes a table value.** Same category as R-SF-01 but strikes the numeric core of the rules-engine directly; a single missed digit change undermines the product's central "trust the numbers" claim.
4. **R-PX-02 — OCR misreads a number.** The rules-engine is only as correct as the numbers it's given; this is the most direct path from a scanned PDF to a wrong, confidently-displayed finding, and it's still human-review-dependent rather than fully automated.
5. **R-LJ-03 — Briefing LLM invents a rule, changes status, or cites an inactive chunk.** This is the exact evidence-chain violation the JEV-bounded, RAG-is-evidence-only, frozen-contract architecture was designed to make structurally hard — worth watching closely precisely because it's the newest and least-proven layer.

## Review cadence

This register is reviewed at every milestone exit (M0 through M6), not just at the end of the project — a new milestone typically introduces new components or data paths that need their own risk entries. Each review checks whether existing mitigations still hold, whether any residual risk has grown, and whether new risks have appeared.

Detection signals in this register are written to become real dashboard panels, not to stay aspirational. By M5 (decision layer, briefing LLM, and validators land), the LLM/JEV safety and tenant isolation detection signals should be live alerts, not manual checks. By M6 (gold set of 50 and the evaluation dashboard), the evaluation design and source freshness/extraction detection signals should be dashboard panels a reviewer can check without asking an engineer to run a query by hand.
