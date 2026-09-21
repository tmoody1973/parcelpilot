# 05 — Decisioning design: rules engine, final status policy, JEV, briefing LLM, validators

**Status:** planning draft, 2026-09-21.
**Reads with:** `02_architecture.md` (component boundaries), `03_data_model.md` (tables named here), `04_zoning_rag_design.md` (where evidence comes from).

This document defines how a run turns facts into a status, in the exact order the PRD requires:

```
parcel facts + scenario inputs + approved rules
        │
        ▼
[1] Rules engine (pure TypeScript) ──► Finding[] + calculations
        │
        ▼
[2] Evidence + citation validation ──► evidence flags, coverage
        │
        ▼
[3] Prepared decision state (frozen JSON, hashed)
        │
        ▼
[4] Decision layer  (DecisionMode flag: rules_only | structured_output_baseline | jev | shadow)
        │
        ▼
[5] Final status policy (deterministic, hard overrides, "never more permissive")  ──► feasibility_runs.final_status, locked_at
        │
        ▼
[6] Frozen briefing contract ──► [7] Briefing LLM (schema output) ──► [8] Validators ──► render or templated fallback
```

Nothing after step 5 can change the status. Nothing before step 4 involves a model.

---

## 1. Deterministic rule evaluation

### 1.1 What a rule is

An **approved rule** is a row in `zoning_rules` (status `approved`, immutable, versioned) that a domain reviewer signed off on, with at least one `rule_citations` row pointing at an active `code_chunks` row and page. A rule is data, not code: the engine has a small fixed set of *rule kinds*, and each row parameterizes one kind.

```ts
type RuleKind =
  | "allowed_use"            // is scenario.use in the allowed list (by right / conditional / prohibited as *data labels* only, never as user-facing verdict)
  | "max_height_ft"
  | "min_setback_ft"         // parameterized by side: front | side | rear
  | "min_lot_area_per_unit"  // density (candidate extra category)
  | "min_parking_per_unit"   // parking (candidate extra category)
  | "max_lot_coverage_pct";  // lot coverage (candidate extra category)

type ZoningRule = {
  id: string;                // immutable version id
  familyId: string;          // stable across versions
  version: number;
  jurisdictionId: "milwaukee-wi";
  districtCode: string;      // e.g. as printed in Ch. 295 (exact string from source)
  category: RuleCategory;    // use | height | setback_front | setback_side | setback_rear | density | parking | lot_coverage
  kind: RuleKind;
  params: Record<string, number | string | string[]>; // e.g. { maxHeightFt: 45 }
  conditions?: RuleCondition[];   // reviewed footnote conditions, see 1.3
  criticality: "critical" | "high" | "medium" | "low";
  citations: Array<{ chunkId: string; documentId: string; page: number; section: string }>;
  effectiveStart: string; effectiveEnd?: string;
  status: "approved";
};
```

### 1.2 Engine contract (pure, typed, no I/O)

```ts
evaluate(input: {
  parcel: ParcelFacts;            // from parcel_snapshots + gis_intersections (lot area, district code(s), overlay codes, ambiguity flags)
  scenario: ScenarioInputs;       // user-confirmed fields only; missing = undefined, never defaulted
  rules: ZoningRule[];            // approved rules for the district(s), effective on the analysis date
  categoriesInScope: RuleCategory[];
}): {
  findings: Finding[];
  calculations: CalculationRecord[];
  coverage: { checked: RuleCategory[]; manual_review: RuleCategory[]; unknown: RuleCategory[] };
}
```

Rules of the engine:

1. **One finding per category in scope.** If no approved rule exists for a category and district → `unknown`. If a rule exists but a required scenario input is missing → `insufficient_evidence` with `missingInputs` listed. If a rule has a reviewed condition the engine cannot evaluate from available facts (e.g. "corner lot") → `verify` with the condition named.
2. **Numbers only from code.** `proposed` comes from the scenario, `allowed` from `rule.params`, `comparison` is a fixed operator per kind. The calc record stores all three plus the rule version id.
3. **Multiple districts on one parcel** (sliver or split lot) → every category returns `verify` with reason `multiple_districts`, and `policy_flags.gis_ambiguity = true`. No attempt to pick the "main" district in v1.
4. **Deterministic and reproducible.** Same input → same output. Test: property-based test asserts idempotence and that no finding is `pass` without a rule id and ≥1 citation.
5. **No model calls, no DB, no clock.** The analysis date is an input.

```ts
type Finding = {
  category: RuleCategory;
  status: "pass" | "fail" | "unknown" | "verify" | "insufficient_evidence";
  criticality: "critical" | "high" | "medium" | "low";
  ruleId?: string; ruleVersion?: number;
  proposed?: { value: number | string; unit?: string; source: "scenario" | "parcel" };
  allowed?: { value: number | string; unit?: string; operator: "<=" | ">=" | "in" | "==" };
  calculationId?: string;
  citations: Array<{ chunkId: string; page: number; section: string }>;
  reason?: string;            // machine-readable: no_rule | missing_input:<field> | condition_unevaluable:<name> | multiple_districts
  missingInputs?: string[];
  confidence: "high" | "medium" | "low"; // high = numeric compare on approved rule; medium = reviewed condition assumed; low = never used for pass
};
```

### 1.3 Footnote conditions

Ch. 295 tables carry footnotes that modify values (corner lots, alleys, adjacency to lower-intensity districts, etc. — exact set to be confirmed by the reviewer from the source tables). A footnote becomes a `RuleCondition` only after review:

```ts
type RuleCondition = {
  id: string;
  description: string;                 // reviewer text, cited to the footnote chunk
  evaluable: boolean;                  // can the engine test it from ParcelFacts/ScenarioInputs?
  predicate?: { fact: string; operator: string; value: unknown };  // only when evaluable
  effect: { param: string; value: number | string } | { status: "verify" };
  citation: { chunkId: string; page: number };
};
```

Non-evaluable conditions force `verify`, never silently ignored. This is the single most important guard against a false `pass`.

### 1.4 Criticality

Set per rule by the reviewer. Defaults proposed for review: `use` = critical; `height` = critical; setbacks = high; density = high; parking = medium; lot coverage = medium. A `critical` or `high` `fail` blocks `proceed_to_concept_design` (see §3).

---

## 2. Evidence and citation validation (deterministic gate before any model)

Runs after the engine, before the prepared state is built. Produces `evidence` flags used by policy and JEV.

| Check | Passes when | On failure |
|---|---|---|
| Active version | Every cited `code_chunks.status = active` and its `source_documents.status = active` and effective on the analysis date | `citation_validator_passed = false` → forces `insufficient_evidence` |
| Citation completeness | Every `pass`/`fail` finding has ≥1 citation with page | same |
| Rule approval | Every finding with a rule id references `zoning_rules.status = approved` | same (should be impossible by construction; test it anyway) |
| Conflicting sources | Two active chunks assert different values for the same rule family | `conflicting_sources = true` → forces at least `verify_before_committing` |
| Retrieval sufficiency (once RAG exists) | For each checked category the `retrieval_evidence` set includes the required context types (table row + footnotes + definition when the rule references a defined term) | `required_context_missing[]` → category downgraded to `verify` |
| Source freshness | `parcel_snapshots.source_retrieved_at` within the configured max age (default 30 days) and layer snapshot hash matches registry | `stale_facts = true` → surfaced in UI; forces `verify_before_committing` if older than 90 days |

---

## 3. Final status policy (the only thing that sets `final_status`)

A pure function. Inputs: findings, evidence flags, coverage, policy flags, and the decision layer's `JevDecision | null`. Output: `FinalStatus`, `route`, and an ordered `reasons[]` list (each reason is machine-readable and cited).

```ts
function finalStatus(state: PreparedDecisionState, decision: DecisionLayerOutput | null): PolicyResult
```

Ordered hard overrides (first match wins for the *floor*; later rules can only make it stricter):

| # | Condition | Forces at least |
|---|---|---|
| O1 | `evidence.citation_validator_passed = false` OR any required source missing/inactive | `insufficient_evidence` |
| O2 | A required scenario field is absent (`policy_flags.missing_required_input`) | `insufficient_evidence` (if the missing field blocks a critical category) else `verify_before_committing` with route `collect_missing_information` |
| O3 | Any finding `fail` with criticality `critical` or `high` | `revise_scenario` (never `proceed_to_concept_design`) |
| O4 | Overlay / special district / unreviewed material condition detected, or `gis_ambiguity`, or `conflicting_sources`, or any category `verify` | `verify_before_committing` |
| O5 | Coverage: any category in scope is `unknown` AND is critical/high | `verify_before_committing` |
| O6 | Decision layer says `manual_review_required` with probability ≥ threshold, or `summary_safe_to_display` < threshold, or route is anything other than `proceed_to_concept_design` / `revise_scenario` | `verify_before_committing` |
| O7 | Decision layer confidence below the calibrated operating threshold | the stricter of the two most probable routes |
| O8 | Decision layer unavailable / errored / disabled | apply rules-only decision table (§4.1) |

Invariant (tested with property-based tests): **`final_status` is never more permissive than the strictest outcome implied by any single override.** Ordering of permissiveness, most to least: `proceed_to_concept_design` > `revise_scenario` > `verify_before_committing` > `insufficient_evidence`.

`proceed_to_concept_design` is reachable only when: all in-scope categories are `pass`, no overrides fire, and the decision layer (if enabled) agrees with probability ≥ threshold. Even then the UI shows the scope caveat and the coverage panel.

The policy writes `feasibility_runs.final_status`, `route`, `policy_reasons`, `locked_at`. After `locked_at` the row is immutable.

---

## 4. Decision layer

### 4.1 `rules_only` mode (always available, the fallback)

A fixed decision table from policy flags to (risk, route):

| State | risk | route |
|---|---|---|
| O1/O2 fired | insufficient_evidence | insufficient_evidence / collect_missing_information |
| O3 fired | high | revise_scenario |
| O4/O5 fired | medium (high if special district) | contact_city if special district, else engage_zoning_professional |
| none fired | low | proceed_to_concept_design |

This is the baseline JEV must beat (PRD §9.3 comparator 1).

### 4.2 `structured_output_baseline` mode

A general LLM (Claude Sonnet 5 by default) with JSON-schema output answering the same four questions from the same prepared state. Logged the same way as JEV. Comparator 2. Never serves users; evaluation only.

### 4.3 `jev` and `shadow` modes

`shadow`: JEV is called and logged on every run, but policy uses `rules_only`. This is the required first production state. `jev`: policy uses JEV output (still subject to §3). Switching to `jev` requires the M6 gates (PRD §9.4) and is enforced by a deploy-time check, not just a flag.

### 4.4 Prepared decision state (JEV input)

Built by `buildPreparedState()` from the run; serialized with stable key ordering; SHA-256 stored as `jev_runs.input_state_hash`. It matches PRD §8.4 with a few changes driven by the Jev 1.13 known-limitations page (read 2026-09-21): **no raw numbers** (Jev "is not a calculator" and judges numeric closeness unreliably; the engine already compared every number, so JEV sees statuses), **no free text** (Jev reads adversarial content at face value; a user's scenario narrative never enters the state), **no irrelevant fields** (accuracy falls with distractors), and a `version` field. It contains no ordinance text, no chunk text, no URLs. The full numeric picture stays in `feasibility_runs` for the briefing LLM and the memo.

```json
{
  "version": "prepared_state.v1",
  "jurisdiction": "milwaukee-wi",
  "parcel": {
    "base_zoning": "RM4",
    "additional_zoning_districts": [],
    "overlays": ["floodplain"],
    "special_districts": [],
    "gis_ambiguities": []
  },
  "scenario": {
    "use": "multifamily",
    "has_ground_floor_commercial": false,
    "missing_fields": []
  },
  "deterministic_findings": [
    { "category": "height", "status": "pass", "criticality": "critical", "confidence": "high", "citation_count": 2, "reason": null }
  ],
  "evidence": {
    "district_verified": true,
    "active_code_version": true,
    "citation_validator_passed": true,
    "required_sections_found": true,
    "required_table_headers_found": true,
    "required_footnotes_found": true,
    "exception_detected": false,
    "overlay_detected": true,
    "overlay_rule_coverage": "manual_review",
    "unsupported_claims": 0,
    "conflicting_sources": false,
    "required_context_missing": [],
    "stale_facts": false
  },
  "coverage": { "checked": ["use", "height", "setback_front"], "manual_review": ["floodplain"], "unknown": ["parking", "density"] },
  "policy_flags": {
    "deterministic_critical_fail": false,
    "special_district_detected": false,
    "missing_required_input": false,
    "gis_ambiguity": false
  }
}
```

### 4.5 JEV request (live API contract, verified 2026-09-21 from docs.typesafe.ai)

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, JSON body `{ "model": "jev-latest", "state": <object>, "questions": { ... } }`.
- Question types: `noul` (yes/no, returns `noul` probability 0–1, **no separate confidence**), `choice` (returns `choice`, `probabilities` map, `confidence` 0–1; max 255 options), `score` (2–10 rubric levels).
- Response: `{ "model": "jev-1.x.y", "answers": { key: {...} }, "usage": { input_tokens, output_tokens } }`. We store `model` verbatim as `jev_runs.model_version`.
- Errors: 401, 422, 429, 529. Retry 429/529 with exponential backoff (max 3 tries, 2 s total budget); then fall back to `rules_only`.
- **Not stated in docs:** determinism/seed, max state size, latency SLAs. Treated as unknowns to measure in M5 (stability metric in PRD §9.4 exists precisely for this). Pin `model` to the exact version string observed in `shadow` mode rather than `jev-latest` once evaluation begins.
- JS SDK: `@typesafe-ai/sdk`, Node 20+, `TYPESAFE_API_KEY` env var, `client.systemOne({ state, questions })`.

Questions (version `jev_questions.v1`; stored in `jev_runs.question_set_version`). All four are asked in one request; they run in parallel and cannot see each other. Instructions embed the full meaning because keys are not sent to the model. Per the TypeSafe primitive docs: risk tier is a position on a spectrum, so it is a **Score** (ordered levels with concrete situations), not a Choice; the PRD's fourth option `insufficient_evidence` is not a risk level and is handled deterministically by overrides O1/O2 plus the `summary_safe_to_display` Noul. Choice criteria use `what` / `not_for` objects because the routes overlap.

```json
{
  "overall_risk": {
    "type": "score",
    "instructions": "Using only the supplied preliminary zoning-screen state for a Milwaukee infill parcel, how much diligence risk does this state show? Weight critical deterministic findings, special conditions, coverage gaps, and evidence quality. An unknown category is never evidence of compliance.",
    "criteria": [
      "Low: every in-scope category is checked and passing, evidence flags are all true, no overlay, special district, ambiguity, or missing input.",
      "Medium: no critical or high failure, but at least one unknown category, a medium/low failure, stale facts, or a detected overlay whose rule coverage is manual_review.",
      "High: a critical or high-criticality failure, a special district, GIS ambiguity, conflicting sources, exception detected, or a required footnote/section not found."
    ]
  },
  "manual_review_required": {
    "type": "noul",
    "instructions": "True only when the supplied state includes a special condition, material missing information, an unsupported required category, conflicting evidence, or a failed major requirement that needs qualified review before reliance.",
    "criteria": { "true": "Qualified human review is needed before anyone relies on this screen.", "false": "The screen can be relied on as a preliminary, scoped result without further review." }
  },
  "recommended_route": {
    "type": "choice",
    "instructions": "Choose the safest single next workflow action supported by the supplied state. When two routes both apply, prefer the one that involves an outside party or collects information over the one that proceeds.",
    "criteria": {
      "proceed_to_concept_design": { "what": "Every in-scope category is pass, evidence flags all true, no overlay, special district, ambiguity, or missing input.", "not_for": "Any unknown category, any verify, any flag set." },
      "revise_scenario": { "what": "A deterministic finding is fail and the concept could plausibly change (height, setback, unit count) to fit.", "not_for": "Failures caused by a special district or overlay; missing inputs." },
      "contact_city": { "what": "A planned development, overlay, redevelopment plan, or GIS ambiguity that only the City can clarify.", "not_for": "Plain dimensional failures." },
      "engage_zoning_professional": { "what": "Conflicting sources, an exception or footnote condition the engine could not evaluate, or a use classification question.", "not_for": "A single missing user input." },
      "collect_missing_information": { "what": "A user-supplied scenario field is missing and would change a finding.", "not_for": "Cases where the sources, not the user, are the gap." },
      "insufficient_evidence": { "what": "Citation validation failed or a required source/section is missing, so no preliminary screen should be shown.", "not_for": "Cases where sources are fine but the concept fails." }
    }
  },
  "summary_safe_to_display": {
    "type": "noul",
    "instructions": "True only if the supplied evidence and coverage permit a preliminary, explicitly scoped summary. Do not treat any unknown category as a verified pass.",
    "criteria": { "true": "A scoped preliminary summary can be shown.", "false": "Show only an insufficient-evidence state." }
  }
}
```

### 4.6 Thresholds (initial, to be replaced by measured values)

No threshold is production-valid until measured on the gold set (PRD §9.4 calibration gate). Initial values for `shadow` mode only:

| Signal | Initial threshold | Effect when not met |
|---|---|---|
| `recommended_route.confidence` | ≥ 0.70 | O7: take the stricter of the top two routes |
| `manual_review_required.noul` | ≥ 0.35 → treat as true | O6 |
| `summary_safe_to_display.noul` | < 0.65 → treat as false | O6 → `insufficient_evidence` display state |
| `overall_risk.score` (0 = low, 1 = medium, 2 = high) | ≥ 1.5 → treat as high; ≥ 0.5 → medium | informational + memo; never relaxes a status. Per the docs, scores are weak at numeric interpolation, so we bucket, never interpolate |

Threshold direction follows the Noul guidance in the docs: raise a threshold when a false "yes" is expensive; lower it when missing a true "yes" is the costly error. Missing a needed manual review is the safety failure here, so `manual_review_required` uses a low threshold (0.35) and `summary_safe_to_display` a high one (0.65).

Thresholds live in `decision_policy_versions` config (versioned JSON in the repo, id stored on each run), not in code constants.

### 4.7 JEV output schema (what we store and what policy reads)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "parcelpilot/jev_decision.v1",
  "type": "object",
  "required": ["input_state_hash", "question_set_version", "model_version", "answers", "latency_ms", "requested_at"],
  "additionalProperties": false,
  "properties": {
    "input_state_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "question_set_version": { "type": "string" },
    "model_version": { "type": "string" },
    "requested_at": { "type": "string", "format": "date-time" },
    "latency_ms": { "type": "integer", "minimum": 0 },
    "answers": {
      "type": "object",
      "required": ["overall_risk", "manual_review_required", "recommended_route", "summary_safe_to_display"],
      "additionalProperties": false,
      "properties": {
        "overall_risk": {
          "type": "object", "required": ["score", "legend", "probabilities", "confidence", "bucket"],
          "properties": {
            "score": { "type": "number", "minimum": 0, "maximum": 2 },
            "legend": { "type": "object", "additionalProperties": { "type": "string" } },
            "probabilities": { "type": "object", "additionalProperties": { "type": "number", "minimum": 0, "maximum": 1 } },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "bucket": { "enum": ["low", "medium", "high"], "description": "derived by code from score thresholds in decision_policy_versions" }
          }
        },
        "manual_review_required": { "type": "object", "required": ["noul"], "properties": { "noul": { "type": "number", "minimum": 0, "maximum": 1 } } },
        "recommended_route": {
          "type": "object", "required": ["choice", "probabilities", "confidence"],
          "properties": {
            "choice": { "enum": ["proceed_to_concept_design", "revise_scenario", "contact_city", "engage_zoning_professional", "collect_missing_information", "insufficient_evidence"] },
            "probabilities": { "type": "object", "additionalProperties": { "type": "number" } },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        "summary_safe_to_display": { "type": "object", "required": ["noul"], "properties": { "noul": { "type": "number", "minimum": 0, "maximum": 1 } } }
      }
    }
  }
}
```

### 4.8 Fallbacks and logging

- Any HTTP error after retries, schema-invalid response, or timeout (>2 s) → `jev_runs.status = failed` with the error, and policy runs in `rules_only`. The UI never mentions JEV.
- Every call logs: input state hash, full input JSON, question set version, model version string, raw response, parsed answers, latency, cost tokens, decision mode, and whether policy used the result. This is what makes the PRD §9 evaluation possible.
- `shadow` mode additionally writes a `decision_comparisons` view row: rules-only route vs JEV route vs (if run) baseline route, plus the gold label when the run is a gold case.

---

### 4.9 Design notes from the TypeSafe docs (read 2026-09-21)

- **One request, four questions.** Independent questions over the same state go in one call and run in parallel (`parallel_questions` cookbook). Never chain a second JEV call on the first's answer inside a run.
- **Literal reading.** Jev answers the question as written. Instructions avoid negations and indirection; every scoping condition is stated positively.
- **No numbers, no counting, no dates.** The state carries statuses, booleans, and short category names. Dates are compared in code (analysis date vs `effective_start/end`), never by JEV.
- **No user text.** Jev does not treat adversarial content as hostile. Scenario narratives, project names, and notes never enter the state; only enum values and flags do.
- **Small state.** Accuracy drops with irrelevant fields. The prepared state is a projection of the run, not the run itself.
- **Confidence is concentration, not correctness.** Thresholds are measured on the gold set (PRD §9.4 calibration gate) and stored in `decision_policy_versions`.
- **Pin the model.** `jev-latest` only in `shadow` before evaluation begins; after that the exact `model` string from responses (e.g. `jev-1.13.x`) is pinned per `question_set_version`.
- **Other bounded JEV uses to evaluate later, none in the status path:** evidence reranking with one Noul per candidate (`rerank_typesafe` cookbook; see `04` §6), passage filtering (`classifying_rag_passages`), and the citation-support validator above.

## 5. Frozen briefing contract (input to the briefing LLM)

Built only after `feasibility_runs.locked_at` is set. Serialized, hashed (`briefing_runs.contract_hash`). Contains verbatim excerpts from the evidence bundle and nothing else textual from the corpus.

```json
{
  "version": "briefing_contract.v1",
  "run_id": "uuid",
  "final_decision": { "status": "verify_before_committing", "risk": "high", "route": "engage_zoning_professional", "status_is_locked": true },
  "parcel_facts": { "taxkey": "...", "address": "...", "lot_area_sqft": 6250, "base_zoning": "RM4", "overlays": ["floodplain"], "facts_retrieved_at": "2026-09-20T14:02:00Z" },
  "scenario": { "use": "multifamily", "units": 24, "height_ft": 46, "stories": 4, "parking_spaces": 12, "ground_floor_commercial_sqft": 0 },
  "verified_findings": [
    { "finding_id": "f1", "category": "height", "status": "pass", "proposed": "46 ft", "allowed": "≤ 45 ft", "calculation_id": "c1", "source_ids": ["chunk_295_...", "chunk_295_..."] }
  ],
  "manual_review_triggers": [ { "trigger_id": "t1", "kind": "overlay", "code": "floodplain", "source_ids": ["gis_layer_snapshot_..."] } ],
  "unknown_or_unsupported_categories": ["parking", "density"],
  "missing_inputs": [],
  "jev_decision": { "selected_values": { "overall_risk": "high", "recommended_route": "engage_zoning_professional" }, "confidence": 0.81, "may_not_override_policy": true },
  "policy_reasons": ["O4:overlay_detected:floodplain"],
  "evidence_bundle": [
    { "source_id": "chunk_295_...", "official_url": "https://...", "document_title": "...", "section": "295-XXX-X", "page": 14, "verbatim_excerpt": "...", "status": "active" }
  ],
  "allowed_next_actions": ["confirm_parking_configuration", "request_early_city_zoning_review", "engage_zoning_professional"],
  "required_disclaimer": "Preliminary zoning screen — not an official zoning determination.",
  "banned_phrases": ["approved", "fully compliant", "by right", "permitted", "compliant"]
}
```

`allowed_next_actions` is computed by policy from status + triggers + missing inputs (a fixed table in `decision_policy_versions`), never free text.

## 6. Briefing LLM

- **Model:** Claude (default `claude-fable-5-1`; `claude-sonnet-5` as the cost option — both evaluated in M5 on citation precision and unsupported-claim rate; pick the cheapest that meets gates). Structured output via JSON schema. No tools, no web, no retrieval. Temperature 0. Prompt version and schema version stored on `briefing_runs`.
- **System prompt (versioned file `prompts/briefing.v1.md`)** states: you are explaining a locked decision; every factual or code sentence must cite `source_ids` from the bundle; you may not compute, recompute, or compare numbers beyond copying `proposed`/`allowed` strings; you may not suggest actions outside `allowed_next_actions`; when status is `insufficient_evidence` explain what is missing and stop.
- Internal reasoning may be used by the model but is never stored or shown; only the JSON output is kept.

### 6.1 Briefing LLM output schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "parcelpilot/briefing_output.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["contract_hash", "status_echo", "executive_summary", "status_explanation", "verified_findings", "open_questions", "suggested_actions", "questions_for_experts", "disclaimer"],
  "properties": {
    "contract_hash": { "type": "string" },
    "status_echo": { "enum": ["proceed_to_concept_design", "revise_scenario", "verify_before_committing", "insufficient_evidence"] },
    "executive_summary": { "$ref": "#/$defs/citedParagraph" },
    "status_explanation": { "$ref": "#/$defs/citedParagraph" },
    "verified_findings": {
      "type": "array",
      "items": { "type": "object", "additionalProperties": false, "required": ["finding_id", "sentences"],
        "properties": { "finding_id": { "type": "string" }, "sentences": { "type": "array", "items": { "$ref": "#/$defs/citedSentence" } } } }
    },
    "open_questions": { "type": "array", "items": { "$ref": "#/$defs/citedSentence" } },
    "suggested_actions": {
      "type": "array",
      "items": { "type": "object", "additionalProperties": false, "required": ["action_id", "rationale"],
        "properties": { "action_id": { "type": "string" }, "rationale": { "$ref": "#/$defs/citedSentence" } } }
    },
    "questions_for_experts": {
      "type": "array",
      "items": { "type": "object", "additionalProperties": false, "required": ["recipient", "question"],
        "properties": { "recipient": { "enum": ["city", "architect", "zoning_professional", "lender_or_partner"] }, "question": { "$ref": "#/$defs/citedSentence" } } }
    },
    "disclaimer": { "type": "string" }
  },
  "$defs": {
    "citedSentence": {
      "type": "object", "additionalProperties": false, "required": ["text", "source_ids", "kind"],
      "properties": {
        "text": { "type": "string", "maxLength": 400 },
        "kind": { "enum": ["fact", "code", "finding", "advice", "framing"] },
        "source_ids": { "type": "array", "items": { "type": "string" } },
        "numbers": { "type": "array", "items": { "type": "object", "required": ["value", "calculation_id"], "properties": { "value": { "type": "string" }, "calculation_id": { "type": "string" } } } }
      }
    },
    "citedParagraph": { "type": "array", "items": { "$ref": "#/$defs/citedSentence" } }
  }
}
```

`kind` lets the validator apply the right rule: `fact`, `code`, and `finding` sentences need ≥1 `source_ids`; `advice` needs an `action_id` link or a trigger source; `framing` (e.g. "This screen is preliminary.") needs none but is checked against the banned list.

## 7. Validators (deterministic, run before render)

Each validator writes a `validation_runs` row (`validator_type`, `passed`, `rejected_items`). Any hard failure → render the templated fallback brief; the LLM text is stored but not shown.

| Validator | Rejects when | Severity |
|---|---|---|
| `schema` | Output does not validate against `briefing_output.v1` | hard |
| `contract_hash` | `contract_hash` ≠ the contract we sent | hard |
| `status_lock` | `status_echo` ≠ `feasibility_runs.final_status` | hard |
| `citation_membership` | Any `source_ids` entry not in `evidence_bundle`, or referenced chunk not `active` at run time | hard for the sentence; hard for the brief if > 10% of sentences |
| `uncited_claim` | A sentence of kind `fact`/`code`/`finding` has zero `source_ids` | sentence removed; hard if any `finding` sentence removed |
| `numeric_alignment` | Any number token in a sentence (regex over digits with units) is not present in the linked `calculations` record's proposed/allowed values or in the parcel facts | sentence removed; hard if in `verified_findings` |
| `action_allowlist` | `suggested_actions[].action_id` not in `allowed_next_actions` | action removed; hard if list becomes empty while status ≠ `proceed_to_concept_design` |
| `banned_phrases` | Any text contains a banned phrase (case-insensitive, word-boundary) | sentence removed; hard if in `executive_summary` |
| `finding_coverage` | A `verified_findings` entry references a `finding_id` not in the contract, or omits a `fail` finding | hard |
| `abstention` | Status is `insufficient_evidence` but output contains `suggested_actions` beyond `collect_missing_information` / `contact_city`, or a feasibility opinion (`kind: finding` sentences) | hard |
| `unknown_as_pass` | A sentence mentions a category from `unknown_or_unsupported_categories` with a `finding` kind | hard |
| `citation_support` (JEV, flag `citation_support_check`) | For every `fact`/`code`/`finding` sentence, one JEV Choice per (sentence, cited excerpt) pair with state `{ claim, section }` and criteria `supports` / `contradicts` / `says_nothing` (the pattern in TypeSafe's citation-check cookbook). `contradicts` or `says_nothing` with confidence ≥ 0.8 → sentence removed; confidence < 0.8 → sentence removed from display and written to `review_tasks` for reviewer sampling. Runs after the deterministic validators, in one batched request per brief. | sentence removed; hard if any `finding` sentence removed. JEV unavailable → validator `skipped`, templated fallback brief renders |

The JEV citation-support check can only remove sentences. It never adds, rewrites, or relaxes anything, so it stays inside the "policy owns status" rule from decision 004.

The same `banned_phrases`, `citation_membership`, and `numeric_alignment` validators also run over the **templated** brief and every UI string in CI, so the fallback path is held to the same rule.

## 8. Logging and reproducibility (every model invocation)

Stored per call, per PRD §10.2 and the task brief:

| Field | JEV (`jev_runs`) | Briefing (`briefing_runs`) | Baseline (`jev_runs` with `provider = baseline`) |
|---|---|---|---|
| input state / contract JSON + SHA-256 | ✓ | ✓ | ✓ |
| prompt / question-set version | `question_set_version` | `prompt_version`, `schema_version` | `prompt_version` |
| model version (verbatim from provider) | ✓ | ✓ | ✓ |
| raw output | ✓ | ✓ | ✓ |
| parsed / validated output | ✓ | ✓ + `validation_runs` ids | ✓ |
| latency, tokens, cost estimate | ✓ | ✓ | ✓ |
| timestamp, decision mode, used-by-policy flag | ✓ | ✓ | ✓ |

A run can be replayed: the same prepared state hash + question set version + pinned model version should yield the same typed result; drift is measured, not assumed (PRD §9.4 stability gate).

## 9. Evaluation hooks

- Every gold case run in CI produces: rules-only route, JEV route (if key present), baseline route, expert label → feeds the M6 dashboard (recall on high-risk, route agreement, unsafe-permissive rate = must be 0, precision delta, calibration curve, repeat consistency, p95 latency, cost).
- Briefing eval per gold case: citation precision, citation completeness (every `fail`/`verify` finding explained), unsupported-claim rate, numeric alignment, status consistency, abstention correctness.
- Unsafe-permissive rate > 0 on the gold set fails CI. This is the one metric that blocks merges from day one of M5.
