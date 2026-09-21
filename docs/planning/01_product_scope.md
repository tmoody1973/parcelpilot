# 01 — Product scope for the first vertical slice

**Status:** planning draft, 2026-09-21. Written by Claude for Tarik's review. Domain-review decisions are flagged, not guessed.
**Source of truth:** `PRD_ ParcelPilot — Milwaukee Zoning Feasibility Copilot.md` (the PRD). This doc translates it into engineering scope; it does not override it.

ParcelPilot produces a **preliminary zoning screen** for a Milwaukee parcel and a proposed infill concept. It never produces an official zoning determination. That single sentence drives every include/exclude decision below.

---

## 1. What "first vertical slice" means

The first slice is the smallest thing that exercises the entire safety chain on **one real Milwaukee parcel**:

> sourced parcel facts → deterministic finding from a reviewed rule → conservative status → page-cited memo

It is *full in workflow fidelity* (search, scenario, findings, status, memo) and *deliberately thin in legal coverage* (one district, three to four rule categories, hand-reviewed rules). Retrieval (RAG), JEV, and the briefing LLM are added in later milestones without changing the user-facing safety policy. See `06_delivery_plan.md` for sequencing.

## 2. Included in the first slice

| Area | Included | Notes |
|---|---|---|
| Jurisdiction | City of Milwaukee only | `jurisdiction_id = milwaukee-wi` hard-coded in v1 |
| Users | Small infill developers, development analysts | Architect / lender personas read memos but get no special UI |
| Parcel selection | Search by address, by TAXKEY, and by map click | All three resolve to the City parcel layer |
| Stacked condos | Detect multiple polygons / TAXKEYs at one point; force user to pick one before analysis | PRD P-04 |
| Site profile | Address, TAXKEY, lot area, selected MPROP attributes, base zoning, data-freshness timestamp | Only fields the parcel layer actually returns (verified in `02_architecture.md` §Sources) |
| GIS constraints | Base zoning district; broad detection of overlays / special districts / floodplain / historic where an official layer exists | Detection only. Interpretation only for reviewed items; otherwise route to `verify_before_committing` |
| Scenario | Structured fields: use, units, stories, height (ft), footprint (sq ft), front/side/rear setbacks (ft), parking spaces, ground-floor commercial sq ft | Narrative-to-fields prefill is optional and off in the first slice |
| Multiple scenarios | ≥2 saved scenarios per parcel, side-by-side compare | PRD S-01 |
| Districts | 2–4 target districts, chosen by the domain reviewer | Engineering assumes one district for the first slice, then expands |
| Rule categories | `use`, `height`, `setback_front`, `setback_side`, `setback_rear`, plus at most one additional reviewed category (`density`, `parking`, or `lot_coverage`) | Category chosen by reviewer; see §5 |
| Rules engine | Pure TypeScript, unit-tested, versioned rules, calc record per finding | No model call anywhere inside it |
| Findings | Per-category status from `pass / fail / unknown / verify / insufficient_evidence` with proposed vs allowed values, calculation, citation, criticality | PRD F-02 |
| Coverage panel | Every run lists `checked`, `manual_review`, `unknown` categories | PRD Z-06 |
| Final status | One of `proceed_to_concept_design / revise_scenario / verify_before_committing / insufficient_evidence` from the deterministic policy function | PRD §5.2 |
| Memo | Saved, shareable, preliminary-status disclaimer, provenance (retrieval time, source versions, rule versions), uncovered categories enumerated | PRD E-01..E-04. Templated renderer in first slice; LLM brief later |
| Evidence viewer | Open the exact official PDF page and anchored excerpt behind any displayed claim | PRD Z-02 |
| Snapshots | Every run pins parcel geometry, layer snapshots, rule versions, inputs, calculations | PRD F-05, P-02 |
| Reviewer tooling | Minimal queue: approve/reject rule candidates, tables, chunks; role-gated | Required before any rule is executable |
| Tenancy | Organizations, users, memberships; Row Level Security on tenant tables | Client docs never cross orgs; official docs shared by jurisdiction |
| Decision modes | Feature flag `rules_only / structured_output_baseline / jev / shadow` | `rules_only` is the only mode that can serve users until JEV clears its gates |

## 3. Explicitly excluded from the first slice (and from v1 unless stated)

| Excluded | Why | Earliest revisit |
|---|---|---|
| Any jurisdiction other than Milwaukee | Wedge | After M6 gates |
| Full Chapter 295 automation | PRD §4 and task brief; coverage is visible, not complete | Never as a "big bang"; category by category after review |
| Automatic interpretation of overlays, planned developments, redevelopment districts, historic districts | Only detect + route | Per overlay, after reviewer approves rules |
| Density, parking, lot coverage, FAR beyond the one extra reviewed category | Keep verified surface small | M3 expansion once reviewer capacity exists |
| Financial underwriting, pro forma, massing/3D, title, environmental, traffic, permit submission | Task brief; downstream of trusted zoning screen | After M6 |
| Project-document ingestion (client uploads of surveys, site plans) | Tenant-scoped storage is designed in the schema, but no upload UI in the slice | After M6 |
| Narrative-to-structured extraction as the primary input path | Optional prefill; the user must confirm every field anyway | M5, behind a flag |
| Generic chatbot UI | Task brief: workspace with map + decision panel, not a chat | Never as primary UX |
| JEV or any LLM computing height, setback, density, parking, coverage, FAR | Hard architecture boundary | Never |
| RAG producing pass/fail | Hard architecture boundary | Never |
| Briefing LLM browsing the web or querying the corpus | Hard architecture boundary | Never |
| Multi-region, SSO/SAML, enterprise integrations, billing | Not needed for pilot | After pilot |
| Mobile app | Desktop web only for pilot | Not planned |
| Title-grade ownership verification | PRD §4 | Not planned |

## 4. PRD acceptance criteria → testable engineering requirements

Each PRD criterion (§12) becomes one or more requirements with a test type. IDs are stable and referenced from `06_delivery_plan.md` and `07_risk_register.md`.

| PRD § | Engineering requirement | ID | Test |
|---|---|---|---|
| 12.1 | Address search returns ≥1 candidate parcel from the City parcel layer; TAXKEY search returns exactly the matching parcel; map click within a parcel polygon returns that parcel | ENG-01a/b/c | Integration test against recorded ArcGIS responses (fixtures), plus one live smoke test in staging |
| 12.2 | When a point resolves to >1 TAXKEY, the UI blocks analysis until the user selects one; the selection is stored on the scenario | ENG-02 | E2E test on a known stacked-condo address (reviewer supplies one) |
| 12.3 | Site profile renders geometry, curated MPROP fields, base zoning, intersecting selected layers, and `source_retrieved_at` per source | ENG-03 | Component test with snapshot fixture; e2e on the demo parcel |
| 12.4 | Scenario CRUD; ≥2 scenarios per parcel; compare view shows both inputs and both statuses | ENG-04 | Integration + e2e |
| 12.5 | Rules engine evaluates ≥3 reviewed categories for each supported district; each finding stores `zoning_rules.id` (versioned) and ≥1 `rule_citations` row | ENG-05 | Unit tests per rule; DB constraint: a `calculations` row without a citation cannot be inserted |
| 12.6 | Every run renders unsupported categories, missing inputs, manual-review triggers, insufficient-evidence conditions as explicit items, never as blank | ENG-06 | Unit test: engine returns `unknown` for any category with no approved rule; UI test: coverage panel lists all `RuleCategory` values |
| 12.7 | Every displayed factual zoning statement links to a `citations` row whose `source_documents.status = active`, with section and page | ENG-07 | Validator unit tests; render-time assertion that throws in dev, falls back in prod |
| 12.8 | Memo export (HTML + PDF) contains disclaimer, status, scenario, findings, unknowns, citations, provenance, next action | ENG-08 | Golden-file test on the demo parcel memo; lint test for banned phrases |
| 12.9 | JEV receives only `PreparedDecisionState`; the JSON sent is hashed and stored; JEV output cannot set `final_status` directly | ENG-09 | Unit test: policy function output is never more permissive than strictest deterministic finding, property-based over random states |
| 12.10 | Briefing LLM is called only after `feasibility_runs.locked_at` is set; output validated for status match, active citations, numeric equality, allowed actions | ENG-10 | Validator tests with adversarial fixtures (changed status, invented rule, stale chunk, wrong number, disallowed action) |
| 12.11 | Pipeline preserves `source_documents` versions, section hierarchy, table–footnote links, page anchors; retrieval gates met on gold set | ENG-11 | Ingestion tests on the real Ch. 295 PDFs; Recall@k and footnote-recall computed in CI against `gold_cases` |
| 12.12 | Evaluation report compares `rules_only`, `structured_output_baseline`, `jev` on the versioned gold set | ENG-12 | Eval job writes a report row per gold-set version; dashboard renders it |
| 12.13 | JEV gates (PRD §9.4) pass, or `DecisionMode` stays `rules_only` in production | ENG-13 | CI check reads latest eval report; deploy config cannot set `jev` if gates fail |
| 12.14 | Domain reviewer sign-off recorded on gold cases and on limitation copy | ENG-14 | `review_tasks` rows with `approved` status for each; release checklist item |

Functional-table requirements from PRD §7 (P-, S-, Z-, F-, E-) map onto the same IDs; the mapping is kept in `06_delivery_plan.md` per milestone.

## 5. High-risk assumptions needing a domain-review decision

These cannot be settled by engineering. Each one is also in `08_open_questions.md`.

| # | Assumption | Why it is risky | Who decides |
|---|---|---|---|
| A1 | The 2–4 target districts are the ones where small multifamily infill actually happens (candidates: RM-family residential, NS/LB-family neighborhood commercial from Ch. 295 subchapters 5 and 6) | Wrong districts = a polished product nobody's deals fall into | Domain reviewer + Tarik |
| A2 | "Use, height, primary setbacks" are the three categories most likely to kill a deal early, so they are the right first deterministic checks | If parking is the real deal-killer in Milwaukee infill, we validated the wrong thing | Domain reviewer |
| A3 | The one extra category is `parking` (vs `density` or `lot_coverage`) | Parking tables are footnote-heavy; extraction risk is highest there | Domain reviewer |
| A4 | Milwaukee's official zoning layer's district-code field can be joined to Ch. 295 district codes without a manual crosswalk | If codes differ (e.g. suffixes, historic labels), every parcel needs a mapping table that must be reviewed | Data engineer + reviewer |
| A5 | A parcel intersecting two zoning polygons is rare enough to route to `verify_before_committing` rather than engineer split-lot logic | If common, the "route conservatively" answer is useless to users | Reviewer supplies frequency; product decides |
| A6 | Overlays and special districts can be *detected* from official GIS layers alone | If some overlays exist only in ordinance text or map PDFs, detection has a blind spot the user won't see | Reviewer + data engineer |
| A7 | Ch. 295 dimensional tables have footnotes that change values (e.g. corner-lot, alley, adjacent-district rules) and those must be reviewed per rule | If footnotes are ignored, deterministic "pass" can be wrong | Reviewer |
| A8 | The conservative labels a planner would give (the gold set) are stable enough that two reviewers agree most of the time | If they don't, "85% route agreement" is unmeasurable | Reviewer pair |
| A9 | Pilot users will accept `verify_before_committing` as a useful answer, not a cop-out | If not, the product's honesty is its weakness | Product, via pilot questions in PRD §9.5 |
| A10 | Milwaukee GIS and ordinance content may be stored, snapshotted, and displayed to paying users | Licensing/terms; see `08_open_questions.md` | Tarik (legal check) |

## 6. Vocabulary the whole codebase uses

Kept here so every doc and every UI string says the same thing.

- **Preliminary zoning screen** — the product output. Never "determination", "approval", "compliance check".
- **Finding** — one rule category's result. Statuses: `pass`, `fail`, `unknown`, `verify`, `insufficient_evidence`.
- **Coverage** — which categories were `checked`, sent to `manual_review`, or `unknown`.
- **Final status** — `proceed_to_concept_design`, `revise_scenario`, `verify_before_committing`, `insufficient_evidence`.
- **Route** — JEV's recommended next workflow action (six values, PRD §8.5). A route is an *input* to the final status policy, never the status itself.
- **Banned output words** — "approved", "fully compliant", "by right", "permitted", "compliant" (as a verdict). A lint rule scans UI strings, memo templates, and briefing output for these.

## 7. Non-goals restated as guardrails

1. The product never says a project *can* be built. It says what it verified, what conflicts, what it could not evaluate, and whom to ask next.
2. A `pass` in one category is never summarized as an overall pass.
3. Unknown is a first-class, visible answer, not an empty cell.
4. A later data or rule change never rewrites a saved run.
