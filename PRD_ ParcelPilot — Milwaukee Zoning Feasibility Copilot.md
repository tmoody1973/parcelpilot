# PRD: ParcelPilot — Milwaukee Zoning Feasibility Copilot

**Document status:** Revised full-product prototype PRD  
**Author:** Manus AI  
**Date:** September 21, 2026  
**Primary decision under test:** Whether JEV materially improves safe, developer-facing zoning-diligence routing beyond deterministic rules and a conventional structured-output model.

## 1. Executive decision

**Proceed with a full-product prototype, not a broad production claim.** ParcelPilot should deliver a polished, end-to-end experience using real Milwaukee parcel, map, and ordinance data. A developer should be able to search a parcel, create a scenario, inspect findings and evidence, receive an appropriately cautious next-step recommendation, and save a shareable evidence package.

The prototype must be **full in workflow fidelity but deliberately bounded in verified legal coverage**. It should not claim to comprehensively determine what may be built in every Milwaukee district or under every exception. When a rule, overlay, site condition, or code version has not been reviewed, the product must show that limitation and route the user to the right next action.

JEV is a plausible fit because ParcelPilot repeatedly needs fast, structured decisions from a mixed state of parcel facts, GIS flags, reviewed calculations, citation quality, and missing inputs. JEV should **not** interpret zoning code, create rules, or make legal conclusions. It should classify a prepared evidence state into routing decisions such as risk tier, evidence sufficiency, missing-information severity, and expert-review requirement. Public JEV documentation describes it as a structured decision model that returns typed, probabilistic answers rather than generated text.[1] [2]

The central product and technical question is therefore not “can JEV answer zoning questions?” It is:

> **Can JEV safely and usefully convert an evidence-backed zoning-screen state into a faster, better-calibrated developer workflow decision than deterministic policy and conventional structured-output models alone?**

## 2. Product thesis and user problem

### 2.1 Product thesis

ParcelPilot helps Milwaukee infill developers decide whether a parcel merits deeper diligence before a purchase contingency, letter of intent, early design spend, or consultant engagement. It produces a source-cited preliminary zoning-risk screen, distinguishes verified findings from unknowns, identifies manual-review triggers, and packages the evidence needed for a discussion with the City, architect, attorney, lender, or investment partner.

The product does **not** issue an official zoning determination. Milwaukee states that zoning depends on both the zoning code and zoning map; properties may also be subject to overlays, planned development districts, redevelopment districts, and separate review processes.[3] The City identifies the Department of Neighborhood Services Development Center as the party that determines official zoning compliance.[3]

### 2.2 Pain point

The relevant pain is not that developers lack a map. It is that an early site screen requires them to reconcile scattered sources under time pressure:

- parcel boundaries, lot area, and MPROP attributes;
- base zoning, overlay, and special-district information;
- lengthy ordinance text, tables, notes, definitions, and amendments;
- incomplete project assumptions;
- site conditions that may change the rules or approval path; and
- a decision about whether to invest additional diligence dollars.

Pre-acquisition land-use diligence is a normal development activity because zoning, permits, surveys, environmental matters, traffic, and other constraints can cause delay or alter project return.[4] ParcelPilot aims to reduce the effort required to reach a **defensible preliminary decision**, not to replace professional diligence.

### 2.3 Job to be done

> When evaluating a possible Milwaukee infill site under a deadline, a development professional needs a fast, evidence-backed way to determine whether the initial concept is plausibly worth pursuing, what could block it, what assumptions remain untested, and whom to involve next.

## 3. Target users and primary use case

| Persona | Context | Primary job |
|---|---|---|
| Small urban infill developer | Typically evaluates several 8–40 unit or mixed-use opportunities at once | Decide whether to pursue, renegotiate, or abandon a site before spending heavily on diligence. |
| Development manager or analyst | Builds early feasibility packages and coordinates outside consultants | Create repeatable, auditable screens that preserve assumptions and sources. |
| Architect or land-use consultant | Shapes a concept and advises on zoning constraints | Review parcel facts, code evidence, assumptions, and exceptions quickly. |
| Lender or investment partner | Reviews early project risk | Understand the status, gaps, and required next action without mistaking the result for a formal determination. |

### 3.1 Initial wedge

The full-product prototype will focus on **Milwaukee multifamily infill**, with optional ground-floor commercial space. It will prioritize two to four selected high-frequency residential and neighborhood-commercial districts after a local reviewer confirms their value.

This wedge is narrow enough to validate accuracy and JEV’s role while still representing a recognizable, commercially useful product.

## 4. Definition of “full-product prototype”

A full-product prototype is a real-data, polished vertical slice of the complete ParcelPilot workflow. It includes the primary user experience, persistence, evidence, and risk-routing surfaces that a future product needs. It does not imply that every zoning rule has been automated.

| Dimension | Full-product prototype | Not claimed at prototype stage |
|---|---|---|
| Geography | City of Milwaukee | Multi-city coverage |
| Parcel data | Live or refreshed City parcel/MPROP data with preserved snapshots | Title-grade parcel or ownership verification |
| Zoning context | Base zoning, selected overlays, special-district detection | Complete automatic interpretation of all overlays and special districts |
| Scenario types | Multifamily infill and selected mixed-use cases | Every land use and asset class |
| Rules | Reviewed rules for selected districts and categories | Full Chapter 295 and amendment coverage |
| Decisioning | Deterministic findings plus JEV-driven route and evidence-state classification | Official zoning approval or legal advice |
| Evidence | Page-level official citations and saved feasibility memo | A substitute for a survey, title report, or zoning letter |
| Collaboration | Saved projects, scenario history, and export/share-ready memo | Enterprise workflow integrations or complete underwriting suite |

The product must present unsupported conditions as **useful constraints**, not as failures of the interface. For example, a detected Planned Development district may result in: “Special district detected. ParcelPilot cannot provide a complete deterministic review for this site. Review the cited approval record and obtain City or zoning-professional guidance before relying on this screen.”

## 5. Product promise and decision states

### 5.1 Product promise

> Select a real Milwaukee parcel, enter a plausible infill concept, and receive a transparent preliminary screen: what ParcelPilot verified, what may conflict with the scenario, what evidence supports each finding, what it did not evaluate, and the next appropriate diligence action.

### 5.2 User-facing decision states

| State | Meaning | Required presentation |
|---|---|---|
| **Proceed to concept design** | No critical failure appears in reviewed checks, evidence is complete for displayed claims, and no high-risk routing trigger is active | Green status with a strong scope caveat. Never use “approved” or “fully compliant.” |
| **Revise scenario** | A reviewed deterministic finding conflicts with the current concept but a revised concept may be viable | Red/amber status with proposed versus allowed values and a clear revision path. |
| **Verify before committing** | An overlay, special district, exception, incomplete input, conflict, or incomplete coverage needs professional or City review | Prominent callout, cited trigger, missing inputs, and recommended recipient. |
| **Insufficient evidence** | Required source, site fact, active version, or reviewed rule coverage is absent | Abstention state with the specific missing evidence and next action. |

A `pass` on one rule category never becomes an overall approval. The overall status must reflect coverage, site context, special-district flags, evidence completeness, and deterministic results.

## 6. End-to-end user workflow

1. The user searches an address or TAXKEY, or selects a parcel on the map.
2. ParcelPilot resolves the candidate parcel using City parcel geometry and MPROP data, then asks the user to choose a TAXKEY if stacked condominium polygons or ambiguous results appear.
3. The site workspace shows parcel geometry, lot area, basic property facts, base zoning, intersecting selected layers, data freshness, and any source ambiguity.
4. The user creates a scenario by entering project type, use, units, height, stories, footprint, setbacks, parking, and optional commercial area. A natural-language description may prefill these fields, but the user must review and edit every extracted field.
5. The deterministic rules engine evaluates only approved, versioned rules for the selected district and scenario.
6. The retrieval system gathers applicable active official ordinance text, definitions, table rows, notes, cross-references, amendment material, and source pages.
7. The application validates that every displayed numeric result maps to a reviewed rule and that every generated factual claim has evidence.
8. JEV receives the prepared state of facts, calculations, coverage, and evidence metadata. It returns typed probabilities for risk, evidence sufficiency, manual-review need, and recommended routing.
9. Deterministic override policy combines calculations and JEV outputs into one conservative decision state.
10. The user reads the decision panel, opens original evidence, changes assumptions if needed, and saves or exports a feasibility memo.

### 6.1 Five-minute demo script

A user searches a real Milwaukee address, confirms the TAXKEY, and enters: “24 apartments, four stories, 46 feet, 12 parking spaces, with ground-floor retail.” Within five minutes, the user sees the parcel facts, base district, selected intersecting constraints, three reviewed findings, unsupported categories, one manual-review trigger when applicable, evidence excerpts, and a concise next-action memo. The saved output is visibly labeled **“Preliminary zoning screen — not an official zoning determination.”**

## 7. Functional requirements

### 7.1 Parcel and map workspace

| ID | Requirement | Acceptance criterion |
|---|---|---|
| P-01 | Search by address, TAXKEY, and map click | A user can identify and select a real parcel. |
| P-02 | Display and preserve parcel geometry | The selected geometry is highlighted and stored in the analysis snapshot. |
| P-03 | Show a curated site profile | The interface shows address, TAXKEY, lot area, available building facts, assessed context, and source freshness. |
| P-04 | Detect stacked condominium parcels | The user must choose the intended TAXKEY before analysis starts. Milwaukee’s parcel layer explicitly documents stacked condominium polygons.[5] |
| P-05 | Identify base zoning and selected spatial constraints | The workspace shows applicable district records or warns of spatial ambiguity. |
| P-06 | Keep the map contextual | By default, display the selected parcel and only layers that intersect or materially affect it. |

### 7.2 Scenario creation and project history

| ID | Requirement | Acceptance criterion |
|---|---|---|
| S-01 | Create multiple scenarios per parcel | The user can save and compare at least two alternatives. |
| S-02 | Capture core scenario assumptions | Project type, uses, units, height, stories, footprint, setbacks, parking, and commercial area are editable structured fields. |
| S-03 | Support narrative-to-structured input | The system may extract draft values from a narrative, but users confirm before analysis. |
| S-04 | Preserve historical inputs | A saved run retains all user inputs and a timestamp. |
| S-05 | Expose missing inputs | Missing inputs are shown as blockers, review triggers, or optional enhancements—not silently inferred. |

### 7.3 Zoning evidence and reviewed rules

| ID | Requirement | Acceptance criterion |
|---|---|---|
| Z-01 | Preserve official source documents | Store official URL, document hash, retrieval time, status, and source version. |
| Z-02 | Provide page-level evidence | Each source-supported conclusion opens the exact page or an anchored excerpt. |
| Z-03 | Retrieve legal context, not isolated fragments | Retrieval expands to relevant headings, definitions, table notes, adjacent provisions, exceptions, and amendments. |
| Z-04 | Version executable rules | Each deterministic calculation stores the specific approved rule version and citation. |
| Z-05 | Prevent draft rules from deciding outcomes | Extracted or unreviewed rules may appear in reviewer tools but cannot generate `pass` or `fail`. |
| Z-06 | Make coverage visible | Every analysis lists checked, manual-review, and unknown categories. |

Milwaukee publishes Chapter 295 in separately organized subchapters and notes that broad provisions and overlay zones can apply across district-specific chapters. The product must therefore retrieve definitions, general provisions, district standards, and overlays as applicable rather than relying on one district table alone.[6]

### 7.4 Feasibility findings

| ID | Requirement | Acceptance criterion |
|---|---|---|
| F-01 | Run reviewed numeric checks in code | Height, setbacks, and other covered standards are calculated deterministically, never by JEV or a text model. |
| F-02 | Return granular findings | Every finding contains category, status, assumptions, proposed and allowed values where relevant, calculation, citation, confidence, and review reason. |
| F-03 | Prevent false positive inference | Unsupported categories return `unknown`, `verify`, or `insufficient evidence`, not `pass`. |
| F-04 | Separate special-condition routing | Overlay, planned-development, redevelopment, historic, floodplain, or related detection produces an explicit trigger with the associated source. |
| F-05 | Preserve an analysis snapshot | A saved result includes parcel facts, geometry, layers, code version, rules, inputs, calculations, retrieval IDs, JEV output, and final decision. |

### 7.5 Saved evidence package

| ID | Requirement | Acceptance criterion |
|---|---|---|
| E-01 | Produce a concise feasibility memo | The memo shows status, scenario, findings, unknowns, citations, and next action. |
| E-02 | Preserve provenance | The memo records data retrieval time, source versions, and rule versions. |
| E-03 | Be suitable for handoff | A development manager can send the memo to an architect, consultant, partner, or lender without losing the limitations and source links. |
| E-04 | Include prominent limitations | Every memo includes the preliminary-status disclaimer and enumerates uncovered categories. |

## 8. JEV: role, boundaries, and decision contract

### 8.1 Why this could be a good JEV use case

ParcelPilot contains several decisions that are structured, repetitive, latency-sensitive, and require more nuance than a simple single Boolean rule:

- Is the available evidence complete enough to show a preliminary summary?
- Does the combined state require manual review even when individual base-rule checks pass?
- Which next workflow route best follows from the evidence and uncertainty?
- Which missing input is material enough to change the result?
- Does the project state resemble a low-, medium-, high-, or insufficient-evidence diligence situation?

These are candidate **System One** decisions: they consume structured application state and should return bounded outputs that software can use immediately. JEV supports choice, score, and yes/no decision types with probabilities and confidence; it is intended to complement, not replace, a generative model for open-ended language.[2]

### 8.2 Explicit non-uses of JEV

JEV must not:

- determine zoning district, overlay intersection, parcel geometry, or lot area;
- calculate height, setback, parking, density, lot coverage, or FAR;
- create, extract, amend, or approve executable zoning rules;
- decide that a code provision legally applies without an evidence-backed rules policy;
- generate citations, legal rationale, or user-facing narrative;
- override any deterministic safety gate; or
- label a project approved, permitted, compliant, or by right.

The system will use deterministic code for calculations and policy gates, retrieval plus citation validation for evidence, and a separate constrained language model only for narrative explanation when needed.

### 8.3 Decision ownership

| Decision | Owner | Rationale |
|---|---|---|
| Parcel/TAXKEY resolution and GIS intersection | GIS service and deterministic spatial logic | This is a factual, reproducible operation. |
| Rule value and calculation | Reviewed rule engine | Numeric and legal-rule logic must be unit-testable and versioned. |
| Citation validity and active-source check | Deterministic validator | A missing or obsolete source is a hard gate, not a probabilistic judgment. |
| Overall route, risk tier, and review prioritization | JEV, bounded by deterministic inputs and overrides | This is the JEV hypothesis under test. |
| User-facing explanation | Citation-constrained language model or templated renderer | JEV does not generate explanatory text. |
| Final user status | Conservative decision policy | A policy layer combines mandatory gates, calculations, and JEV probabilities. |

### 8.4 JEV input state

JEV receives only confirmed parcel facts, user-confirmed scenario inputs, reviewed calculations, evidence metadata, coverage, and rule-based flags. It never receives raw unrestricted web content or a prompt asking it to infer absent zoning facts.

```json
{
  "parcel": {
    "taxkey": "string",
    "lot_area_sqft": 6250,
    "base_zoning": "RM4",
    "overlays": ["floodplain"],
    "special_districts": [],
    "gis_ambiguities": []
  },
  "scenario": {
    "use": "multifamily",
    "units": 24,
    "height_ft": 46,
    "stories": 4,
    "parking_spaces": 12,
    "ground_floor_commercial_sqft": 0
  },
  "deterministic_findings": [
    {
      "category": "height",
      "status": "pass",
      "criticality": "high",
      "confidence": "high",
      "citation_count": 2
    }
  ],
  "evidence": {
    "active_code_version": true,
    "citation_validator_passed": true,
    "unsupported_claims": 0,
    "conflicting_sources": false
  },
  "coverage": {
    "checked": ["use", "height", "setbacks"],
    "manual_review": ["floodplain"],
    "unknown": ["parking", "density"]
  },
  "policy_flags": {
    "deterministic_critical_fail": false,
    "special_district_detected": false,
    "missing_required_input": false
  }
}
```

### 8.5 JEV questions and typed output

```json
{
  "overall_risk": {
    "type": "choice",
    "options": ["low", "medium", "high", "insufficient_evidence"],
    "instructions": "Classify preliminary zoning diligence risk using only the supplied state. Weight critical deterministic findings, special conditions, coverage gaps, and evidence quality."
  },
  "manual_review_required": {
    "type": "noul",
    "instructions": "True only when the supplied state includes a special condition, material missing information, unsupported required category, conflicting evidence, or a failed major requirement that needs qualified review before reliance."
  },
  "recommended_route": {
    "type": "choice",
    "options": [
      "proceed_to_concept_design",
      "revise_scenario",
      "contact_city",
      "engage_zoning_professional",
      "collect_missing_information",
      "insufficient_evidence"
    ],
    "instructions": "Choose the safest next workflow action supported by the supplied state."
  },
  "summary_safe_to_display": {
    "type": "noul",
    "instructions": "True only if the supplied evidence and coverage permit a preliminary, explicitly scoped summary. Do not treat any unknown category as a verified pass."
  }
}
```

The application retains JEV’s selected value, probability distribution, confidence, prompt version, input-state hash, and model version with the feasibility run.

### 8.6 Hard overrides and conservative fallback

The following rules always supersede JEV:

1. A deterministic critical `fail` prevents `proceed_to_concept_design`.
2. A missing citation, inactive source, failed citation validator, or missing required source forces `insufficient_evidence`.
3. A detected overlay, special district, or unreviewed condition that is material to the scenario forces at least `verify before committing`.
4. A user-confirmed required scenario field that is absent forces `collect_missing_information` or `insufficient_evidence`.
5. A JEV confidence or probability below the calibrated operating threshold triggers the safer of the two plausible routes.
6. A final decision may never be more permissive than the strictest deterministic finding or policy flag.

This design means JEV can make the workflow more useful but cannot create a false positive by itself.

### 8.7 Detailed brief after JEV: recommended two-stage model design

**Yes.** After the deterministic policy layer has applied hard overrides to JEV’s typed decision, ParcelPilot should call a capable LLM with reasoning to produce the detailed feasibility brief, explanation, and suggested next steps. This is the right division of labor: JEV makes the bounded workflow decision quickly, while the reasoning model turns an approved evidence state into a clear developer-facing explanation.

The system must not use a free-form “JEV said high risk; explain why” prompt. That could weaken the approved route, invent a zoning rule, or create legal-sounding advice. Instead, the briefing LLM receives a **frozen briefing contract** only after final policy state is set.

```text
GIS facts + reviewed calculations + retrieved official evidence
                           ↓
Citation and deterministic-policy validation
                           ↓
JEV typed risk / route / completeness output
                           ↓
Hard overrides and final status policy
                           ↓
Frozen briefing contract
                           ↓
Reasoning LLM creates cited explanation and action brief
                           ↓
Claim validator and deterministic renderer
```

The reasoning model may reason internally to organize a complex evidence set, but ParcelPilot should not expose chain-of-thought. It should return a structured answer with claim-to-citation links that the application can validate and render.

#### Frozen briefing contract

The LLM receives only confirmed facts, user-confirmed assumptions, reviewed findings, the locked final status and route, JEV’s decision values, manual-review triggers, unknown categories, allowed actions, and a small official-source evidence bundle. The model does not access the open web, an unfiltered vector store, or raw PDFs.

```json
{
  "final_decision": {
    "status": "verify_before_committing",
    "risk": "high",
    "route": "engage_zoning_professional",
    "status_is_locked": true
  },
  "verified_findings": [],
  "manual_review_triggers": [],
  "unknown_or_unsupported_categories": [],
  "jev_decision": {
    "selected_values": {},
    "confidence": 0.0,
    "may_not_override_policy": true
  },
  "evidence_bundle": [
    {
      "source_id": "chunk_295_xxx",
      "official_url": "https://...",
      "section": "295-XXX",
      "page": 14,
      "verbatim_excerpt": "..."
    }
  ],
  "allowed_next_actions": [
    "revise_height",
    "confirm_parking_configuration",
    "request_early_city_zoning_review",
    "engage_zoning_professional"
  ],
  "required_disclaimer": "Preliminary zoning screen; not an official zoning determination."
}
```

The JSON-schema constrained output must contain an executive summary, explanation of the locked status, verified findings, open questions, evidence-backed suggested actions, questions for the City/architect/consultant, and the required disclaimer. Every factual or code-related sentence must reference one or more `source_id` values from the supplied evidence bundle. Suggested actions must be selected from `allowed_next_actions`.

The LLM may explain why an action is appropriate, but it may not invent a legal strategy, relax the final decision, recalculate a standard, claim approval, or characterize an unknown category as a pass. When the decision is `insufficient_evidence`, the brief must explain the missing evidence and stop rather than offering a feasibility opinion.

Before display, the application must confirm that the returned status matches the locked final status, all cited source IDs belong to active evidence records, every number matches the calculation record, and every action is on the allowed-action list. Any unsupported sentence is removed, or the application renders a deterministic fallback brief.

This pattern makes the detailed report useful without giving a generative model authority to make the zoning decision. It also keeps JEV’s value measurable: the LLM explains the route, while JEV remains the model evaluated for making the route better.

## 9. JEV evaluation plan: the actual prototype objective

The project should be treated as a product prototype **and** a JEV evaluation harness. Merely putting JEV behind a `risk_tier` field will not prove it adds value; many simple risk classifications can be hard-coded.

### 9.1 Hypotheses

| ID | Hypothesis | What would disprove it |
|---|---|---|
| H1 | JEV improves manual-review routing over deterministic policy alone without reducing high-risk recall. | It misses more expert-labeled high-risk cases or provides no precision/time benefit. |
| H2 | JEV identifies material missing-information states better than a simple required-fields check. | Expert reviewers find its flags unhelpful, inconsistent, or no better than rules. |
| H3 | JEV produces stable, calibrated confidence for comparable evidence states. | Similar inputs yield meaningfully different routes or confidence does not correlate with correctness. |
| H4 | JEV’s latency and cost permit interactive use in the live workflow. | It materially delays the screen or cannot be run at economically acceptable volume. |
| H5 | JEV adds decision value without becoming a hidden legal-reasoning system. | It needs access to raw code text or causes users to misunderstand its route as a zoning determination. |

### 9.2 Gold dataset and labels

Build a versioned Milwaukee gold set before any external pilot. It should contain at least **50 expert-reviewed scenarios** across selected districts, supplemented by synthetic variations only where they preserve realistic factual and legal conditions. Each case should contain the parcel or controlled site facts, code and data version, scenario, reviewed calculations, expected decision state, mandatory review triggers, and required source passages.

The set must include straightforward covered cases, height and setback failures, mixed-use classification questions, incomplete parking facts, floodplain or overlay triggers, special-district cases, stacked condominium ambiguity, amended or superseded code, missing source data, and conflicting evidence.

A planner, architect, or zoning attorney must label the correct conservative route and explain the reason. When reviewers disagree, the gold case must preserve the disagreement and default to the safer route instead of fabricating one authoritative answer.

### 9.3 Comparators

Evaluate three routing methods against the same frozen state:

1. **Rules-only baseline:** deterministic policy flags and a fixed decision table.
2. **Conventional structured-output baseline:** a general model constrained to the same answer schema and evidence state.
3. **JEV:** the typed JEV decision contract specified above.

This comparison answers the real question: whether JEV is a better option for this decision layer—not merely whether it can produce an answer.

### 9.4 Evaluation metrics and launch gates

| Category | Metric | Prototype gate |
|---|---|---|
| Safety | High-risk/manual-review recall | JEV must not be lower than the rules-only baseline; target at least 95% on expert-labeled high-risk cases. |
| Routing quality | Exact or safe-equivalent route agreement | Target at least 85% agreement with expert-reviewed routing labels. |
| Evidence safety | Unsafe permissive route rate | 0% where deterministic gates or labels require manual review or insufficient evidence. |
| Added value | Manual-review precision or analyst-time reduction | Improve precision by at least 10 percentage points over rules-only **or** reduce analyst routing time by at least 25%, without safety degradation. |
| Calibration | Reliability of confidence against correctness | Confidence bands must be empirically measured; no unvalidated confidence threshold may be used in production. |
| Stability | Repeat-route consistency on identical state | 100% identical typed result for an identical frozen input, subject to provider determinism guarantees; otherwise measure and document variance. |
| Performance | Decision-layer latency | p95 at or below one second for a standard prepared state. |
| Cost | Cost per completed screen | Record and compare to structured-output baseline; set commercial pricing only after pilot-volume measurement. |

If JEV does not clear the incremental-value gate, ParcelPilot should retain the deterministic policy layer and remove JEV from the critical path. That would still leave a viable zoning-diligence product, while giving a clean answer to the JEV use-case question.

### 9.5 Pilot feedback questions

During a limited pilot, ask each user:

- Did the screen change whether they pursued, renegotiated, or delayed a site?
- Which flagged issue was most useful?
- Which JEV route did they disagree with, and why?
- Was the explanation of uncertainty sufficient to know what to do next?
- Would they forward the memo to an architect, attorney, partner, or lender?
- How long would the comparable initial screen have taken without ParcelPilot?
- Would they pay for the evidence package, and at what expected screening volume?

The user should not be asked to judge JEV as an abstract model. They should judge whether the final routing decision saved time or prevented a costly misunderstanding.

## 10. Technical and safety architecture

### 10.1 Controlled evidence chain

```text
Official zoning PDFs ──→ versioned ingestion ──→ structured code corpus
                                                   ↓
Parcel selection + scenario ──→ GIS facts ──→ retrieval query plan
                                                   ↓
                               Reviewed rule engine → calculations
                                                   ↓
                                      Evidence bundle and citation validation
                                                   ↓
                                   Prepared, bounded JEV decision state
                                                   ↓
                         JEV risk / route / completeness classification
                                                   ↓
                         Hard deterministic overrides and final status policy
                                                   ↓
                       Frozen briefing contract for a reasoning-capable LLM
                                                   ↓
                      Claim validation, deterministic rendering, saved memo
```

### 10.2 Architecture principles

- **Facts are sourced.** Parcel and GIS facts retain source, field, and retrieval-time provenance.
- **Rules are reviewed.** Only approved, versioned rules can create deterministic findings.
- **Numbers are calculated.** Calculations run in tested code and retain their inputs.
- **Evidence is inspectable.** A user can open the document and page supporting a displayed claim.
- **JEV is bounded.** It receives a finite typed state and makes only typed workflow decisions.
- **The briefing model is bounded.** It explains a locked decision from an approved evidence bundle; it never creates the decision.
- **RAG produces evidence, not decisions.** Retrieval selects and organizes official source material for the rules engine, JEV state builder, and briefing model. It cannot by itself make a pass/fail determination.
- **Conservatism wins.** Unknown, stale, conflicting, or incomplete information must not yield a permissive result.
- **History is immutable.** A later data or rule update does not overwrite the evidence used in a saved run.

### 10.3 Suggested implementation

| Concern | Prototype approach |
|---|---|
| Web application | Next.js and TypeScript |
| Map | MapLibre GL JS or Mapbox GL JS |
| Transactional and spatial store | PostgreSQL with PostGIS |
| GIS ingestion | Official Esri REST data pull with source timestamp and version snapshot |
| Document storage | Immutable S3-compatible object storage; save original PDF, hash, source URL, retrieval time, and active/superseded status |
| PDF extraction | Python worker using PyMuPDF and pdfplumber; OCRmyPDF/Tesseract only for pages with inadequate native text |
| Table extraction | Camelot or Tabula for candidate tables, plus stored page image and mandatory reviewer approval before a table informs a rule |
| Search and vectors | PostgreSQL full-text search (`tsvector`) for exact legal terms and section numbers, pgvector for semantic retrieval, and a cross-encoder reranker; consider OpenSearch only if evaluation shows Postgres lexical recall is inadequate |
| Rules engine | Typed TypeScript module with unit tests and rule/version records |
| Evidence retrieval | Query planner plus metadata filters, lexical search, semantic search, table lookup, cross-reference expansion, and reranking |
| Decision model | JEV behind a feature flag, with a rules-only fallback and logged comparison mode |
| Briefing model | A reasoning-capable LLM using JSON-schema output and the frozen briefing contract; no direct access to the open web or raw unfiltered corpus |
| Validators | Deterministic rule/citation/version checks; claim-to-source validator for LLM brief; schema validation for all model outputs |
| Background work | Queue worker for source refresh, parsing, embedding, reviewer tasks, and evaluation runs |
| Evaluation | Versioned gold dataset, retrieval and claim-support metrics, evaluator labels, route-comparison dashboard, and regression tests |

### 10.4 Zoning-code PDF RAG stack

The RAG system is the evidence layer that turns Milwaukee’s official zoning PDFs into searchable, versioned, and auditable source material. It does not send an entire zoning code to either JEV or the briefing LLM. The Urban Institute’s zoning RAG research shows why this matters: zoning documents are difficult to navigate, relevant rules are often distributed across sections, and retrieval quality directly affects answer quality.[8] The research evaluates accuracy, relevance, correct source-section retrieval, consistency, and appropriate uncertainty—criteria ParcelPilot should adopt.[8]

#### A. Source registry and versioning

Maintain a source registry for each official ordinance PDF, amendment, map legend, staff guidance document, and special-district record that the product supports. A source record stores the jurisdiction, source type, official URL, retrieval timestamp, SHA-256 hash, published or effective date if available, page count, status, and the document it supersedes.

A scheduled worker checks official sources for a changed hash or a new amendment. It downloads a new document as `pending_review`; it never silently replaces an active document. A reviewer must confirm affected sections, tables, and executable rules before a new source or rule version becomes active.

#### B. Parsing and normalization pipeline

1. Download and store the original PDF immutably.
2. Extract page-level native text with PyMuPDF or pdfplumber and measure extraction quality.
3. OCR only poor-quality pages, retaining both the rendered page image and OCR confidence.
4. Detect chapter, subchapter, section, subsection, headings, numbered clauses, definitions, cross-references, and page boundaries.
5. Extract candidate tables separately. Preserve the table image, headers, rows, units, and footnotes together; zoning footnotes must not be detached from the values they modify.
6. Normalize citations and cross-references into links such as `295-XXX(2)(b)` to a definition, exception, table note, or overlay provision.
7. Generate review tasks for ambiguous hierarchy, low-confidence OCR, tables, footnotes, and every proposed executable rule.
8. Publish only reviewed chunks and rule records to the active corpus.

The output is not arbitrary token chunks. Each chunk is a self-contained operative provision or complete table row with its heading, applicable district or overlay, associated footnotes, nearby exception, page range, and pointers to preceding and following provisions. Document headings, section structure, and smaller self-contained material improve retrieval quality; document-organization guidance similarly recommends preserving headings and breaking large multi-topic documents into well-titled units.[9]

#### C. Core evidence schema

```ts
type CodeChunk = {
  id: string;
  jurisdiction: "milwaukee-wi";
  codeFamily: "zoning";
  chapter: string;
  subchapter?: string;
  section: string;
  subsection?: string;
  heading?: string;
  sourceType: "ordinance_text" | "table_row" | "footnote" | "definition" | "amendment" | "map_legend";
  districtCodes: string[];
  overlayCodes: string[];
  ruleCategories: Array<"use" | "height" | "setback" | "density" | "parking" | "procedure" | "definition">;
  documentId: string;
  officialUrl: string;
  documentHash: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  status: "pending_review" | "active" | "superseded";
  pageStart: number;
  pageEnd?: number;
  text: string;
  tableJson?: Record<string, unknown>;
  parentSectionId?: string;
  precedingChunkId?: string;
  followingChunkId?: string;
  crossReferenceIds: string[];
  reviewerStatus: "unreviewed" | "reviewed" | "approved";
};
```

The related transactional records should include `source_documents`, `document_pages`, `code_sections`, `code_chunks`, `source_tables`, `table_footnotes`, `zoning_rules`, `rule_citations`, `retrieval_runs`, and `claim_validation_runs`.

#### D. Indexes and retrieval plan

For every active chunk, generate a full-text index, an embedding vector, and normalized metadata. Do not let a semantic vector search run across all documents without filters.

For a selected parcel and scenario, the query planner first constructs subquestions: district and overlay applicability; allowed use; height; setbacks; density; parking; and procedure. It then retrieves evidence in this order:

1. **Hard metadata filters:** Milwaukee only, active sources only, effective version at the analysis date, relevant chapter families, known district and overlay codes, and relevant rule categories.
2. **Exact legal lookup:** PostgreSQL full-text and structured lookup for district codes, section numbers, defined terms, use names, and cross-references.
3. **Semantic retrieval:** pgvector search for conceptually relevant language, especially user terminology that does not exactly match ordinance terms.
4. **Table and rule lookup:** Retrieve relevant reviewed-rule records and the complete source table row, header, and footnote that support each rule.
5. **Required context expansion:** Follow parent headings, definitions, adjacent subsections, exceptions, overlay rules, general provisions, and amendments before deciding the evidence bundle is complete.
6. **Reranking:** Rank the merged candidate set using a cross-encoder or other reranker that sees the subquestion, district, overlay, and scenario context.
7. **Evidence bundle construction:** Store the top evidence spans, why each was selected, source IDs, document/page anchors, version status, and whether required related context was found.

This hybrid pattern is necessary because zoning questions combine exact lexical retrieval problems—district codes, defined terms, section numbers, and table labels—with semantic questions about a proposed development concept.[8]

#### E. How RAG serves the rule engine, JEV, and briefing LLM

| Consumer | What it receives from the RAG layer | What it must not do |
|---|---|---|
| Reviewed rule engine | Approved `zoning_rules` plus exact rule citations and source version | Create a rule from a raw retrieved chunk. |
| JEV state builder | Structured evidence signals: required sections found, active version, exception/overlay detected, source conflict, citation validation result, coverage gaps, and reviewed findings | Give JEV unrestricted raw PDFs or ask it to interpret operative code. |
| Reasoning briefing LLM | A small approved evidence bundle of verbatim excerpts with page-level citations, plus locked decision and reviewed findings | Search the corpus itself, browse the web, or draw on uncited zoning knowledge. |
| Source viewer | Original PDF page, anchored excerpt, table image, and relationship to the displayed claim | Hide source limits or replace the official document with an AI paraphrase. |

JEV therefore **uses RAG-derived evidence metadata, not RAG as a reasoning substitute**. The briefing LLM uses actual retrieved excerpts to explain the decision. JEV assesses the quality and implications of a prepared evidence state, while the LLM explains the evidence without changing the decision.

#### F. Retrieval and briefing evaluation

Track retrieval and generation separately. The gold set should record primary operative sections, necessary definitions, table notes, overlays, and expected decision for each case. Evaluate Recall@k for required passages, exact table/footnote recall, active-version correctness, district/overlay filter correctness, and completeness of the final evidence bundle.

For every generated brief, evaluate citation precision, citation completeness, numeric alignment to calculations, unsupported-claim rate, status consistency with the locked decision, and correct abstention. TREC’s RAG evaluation framework similarly treats relevance, response completeness, attribution verification, and agreement as separate dimensions; ParcelPilot should not accept decorative citations as sufficient evidence.[10]

## 11. Delivery plan

### Phase 0 — Product contract and JEV harness foundation

Define target districts, scenario types, decision states, JEV state schema, deterministic override policy, and source registry. Recruit at least one domain reviewer and create the first 15 labeled gold cases. Build feature-flag support to compare rules-only, structured-output baseline, and JEV routes without changing the user-facing safety policy.

### Phase 1 — Full parcel-to-scenario experience

Build address/TAXKEY/map selection, MPROP profile, selected map layers, source freshness, scenario creation, user confirmation, projects, and scenario history. Support saved but initially unscored scenarios to validate the UX before broad rule work.

### Phase 2 — Evidence and reviewed-rule vertical slice

Ingest the needed official documents for the selected districts through the versioned RAG pipeline. Build page-level source viewing, chunk and table review queues, metadata-filtered hybrid retrieval, reviewed rule records, and deterministic checks for use, height, and primary setbacks. Add explicit unknown and manual-review states. Establish baseline retrieval Recall@k and table/footnote recall on labeled source passages.

### Phase 3 — JEV decisioning, reasoning brief, and report experience

Implement prepared-state construction, JEV calls, decision logging, deterministic overrides, confidence policy, and the frozen briefing contract. Add the reasoning-capable LLM to produce a claim-cited feasibility brief only after decision policy locks the result. Validate every generated claim, number, status, and suggested action before rendering the report. Add a comparison dashboard that scores JEV beside the rules-only baseline for every gold case.

### Phase 4 — Evaluation and limited pilot

Expand the gold set to at least 50 reviewed cases. Correct retrieval, policy, and workflow failures before pilot. Test ten to twenty real or historical developer sites, record user feedback and time saved, and evaluate JEV against the launch gates.

### Phase 5 — Expansion only after evidence

Expand districts, rule categories, overlay support, project-document ingestion, massing, financial integrations, and multi-city architecture only after the selected-district workflow and the JEV hypothesis meet their gates.

## 12. Prototype acceptance criteria

The full-product prototype is ready for a limited pilot only when it can reliably do all of the following:

1. A user can select a real Milwaukee parcel through address, TAXKEY, or map click.
2. The user can resolve stacked or ambiguous parcel records before analysis.
3. The application shows parcel geometry, curated MPROP data, base zoning, selected spatial constraints, and source freshness.
4. The user can create, modify, save, and compare multifamily or selected mixed-use scenarios.
5. The rules engine evaluates at least three reviewed categories for supported districts, with rule-versioned calculations and official citations.
6. The product visibly identifies all unsupported categories, missing inputs, manual-review triggers, and insufficient-evidence conditions.
7. Every displayed factual zoning statement has a validated active official source citation, document section, and page.
8. The product produces a saved, shareable feasibility memo that preserves scope limitations and provenance.
9. JEV receives only prepared, evidence-backed state, returns typed decisions, and cannot bypass deterministic safety gates.
10. The briefing LLM can only explain a locked policy decision from the approved evidence bundle and passes claim, numeric, citation, and action validation before display.
11. The RAG pipeline preserves source versions, hierarchy, table-footnote relationships, and page-level anchors, and meets the defined retrieval evaluation gates on the gold set.
12. The JEV evaluation reports performance against the rules-only and conventional structured-output baselines on the versioned gold set.
13. JEV meets the safety and incremental-value launch gates in Section 9.4, or is disabled from the critical path.
14. A domain reviewer has reviewed the core test scenarios and the user-facing language that describes limitations.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| False confidence from partial zoning coverage | Make coverage visible, use conservative decision policy, and require review flags for uncovered material conditions. |
| Incorrect rule extraction from PDF tables | Preserve original page image; human-review every executable rule before release. |
| Stale or superseded ordinance text | Track official source, hash, effective date, retrieval date, and active/superseded status. |
| GIS mismatch or ambiguous parcel selection | Preserve a geometry snapshot, show source freshness, surface ambiguity, and require TAXKEY confirmation. |
| JEV is no better than a deterministic policy | Treat this as a valid evaluation result; use the rules-only fallback and do not force JEV into the final product. |
| JEV is overconfident or unstable | Measure calibration and repeatability, set conservative thresholds, and route low-confidence cases to the safer action. |
| Reasoning LLM changes or overstates the decision | Freeze the status and route before generation; validate claim citations, numeric values, and allowed actions; fall back to a deterministic report on failure. |
| RAG retrieves a rule but misses an exception or table footnote | Require context expansion, table/footnote preservation, gold-set retrieval tests, and manual review of executable rules. |
| User mistakes a screen for legal advice | Use clear preliminary-status language, visible limitations, source links, and an expert-review path. |
| Scope expansion delays learning | Freeze district, scenario, and rule coverage until the end-to-end prototype and JEV evaluation are complete. |

## 14. Product positioning

ParcelPilot should not initially compete as a broad 3D massing or pro-forma platform. Existing feasibility products already offer parcel drawing, setback and parking controls, massing, financial assumptions, and report exports.[7] ParcelPilot’s defensible initial position is **jurisdiction-specific, official-source-cited zoning diligence with transparent uncertainty and a shareable evidence trail**.

Massing, financial analysis, and deal sourcing can become valuable extensions after the product demonstrates that developers trust the zoning-screen workflow. They should be downstream of reliable zoning evidence, not substitutes for it.

## 15. Final recommendation

ParcelPilot is a strong full-product-prototype concept and a **credible JEV test case** when built with the boundaries above. It has a meaningful workflow outcome, a structured state, repeated and latency-sensitive routing decisions, clear deterministic safety constraints, and an expert-reviewable gold dataset. Those are the characteristics needed to test whether a decision model provides practical value.

The product should not be presented as “JEV reads zoning law.” The correct proposition is:

> **ParcelPilot assembles verified parcel, rule, and evidence state; JEV helps decide how safely to route the developer’s next diligence action.**

That distinction protects users, makes the architecture credible, and creates a measurable standard for success. If JEV improves manual-review routing, completeness decisions, or analyst time without reducing safety, it is a good fit. If it does not, the prototype will still have produced a useful zoning-diligence product and a rigorous negative result rather than a forced AI feature.

## References

[1]: https://typesafe.ai/blog/introducing-system-one-models-and-jev "Introducing System One Models & Jev"
[2]: https://www.langchain.com/blog/building-a-harness-with-jev "Building a Harness with Jev"
[3]: https://city.milwaukee.gov/DCD/Planning/PlanningAdministration/Zoning "City of Milwaukee Zoning Information"
[4]: https://www.schwabe.com/service/land-use/entitlement-due-diligence/ "Due Diligence & Project Feasibility Analysis"
[5]: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/property/parcels_mprop/MapServer/2 "City of Milwaukee Parcels - MPROP_full ArcGIS REST Layer"
[6]: https://city.milwaukee.gov/ZoningCode "DCD Quick Link to the Milwaukee Zoning Code of Ordinances"
[7]: https://deepblocks.com/dev/ "Deepblocks Developer Feasibility Workflow"
[8]: https://datacatalog.urban.org/data-at-urban/could-retrieval-augmented-generation-large-language-models-help-make-local-zoning "Could Retrieval-Augmented Generation with Large Language Models Help Make Local Zoning Codes Easier to Navigate?"
[9]: https://docs.aws.amazon.com/prescriptive-guidance/latest/writing-best-practices-rag/best-practices.html "Documentation Best Practices for RAG Applications"
[10]: https://trec.nist.gov/pubs/trec34/papers/Overview_rag.pdf "Overview of the TREC 2025 Retrieval Augmented Generation Track"
