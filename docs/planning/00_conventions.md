# 00 — Conventions and canonical names

Every planning doc uses these names exactly. Change them here first, then everywhere.


## Product boundaries (from PRD + task brief, non-negotiable)
- Output is a "preliminary zoning screen — not an official zoning determination". Never the words approved / fully compliant / by right / permitted / compliant (as a verdict) in product copy. Ordinance table labels such as "permitted use" may be quoted as data with the source cited.
- Numeric checks (use, height, setback, and at most one more category) run in a pure TypeScript rules engine over approved, versioned rules. No LLM, no JEV computes numbers.
- RAG = evidence retrieval only. It never emits pass/fail.
- JEV = bounded decision model over prepared state. Outputs: overall_risk (Score), manual_review_required (Noul), recommended_route (Choice), summary_safe_to_display (Noul); optional citation_support (Choice) as a brief validator that can only remove sentences. Never sees raw PDFs.
- Final status = deterministic policy function AFTER JEV, applying hard overrides. Never more permissive than the strictest deterministic finding or policy flag.
- Briefing LLM runs only after status is locked; input = frozen briefing contract; output = schema-constrained JSON; validated before render; fallback = templated deterministic brief.
- Every user-facing zoning fact has a page-level citation to an active official source, or is shown as unknown / verify / insufficient_evidence.
- Municipal official documents: shared per jurisdiction. Project/client documents: tenant-scoped, never cross org boundaries.

## Canonical enums
FinalStatus: proceed_to_concept_design | revise_scenario | verify_before_committing | insufficient_evidence
FindingStatus (per rule category): pass | fail | unknown | verify | insufficient_evidence
Criticality: critical | high | medium | low
RuleCategory (v1): use | height | setback_front | setback_side | setback_rear | (+ one of: density | parking | lot_coverage, chosen by reviewer)
CoverageBucket: checked | manual_review | unknown
JevRoute: proceed_to_concept_design | revise_scenario | contact_city | engage_zoning_professional | collect_missing_information | insufficient_evidence
JevRisk: low | medium | high  (a JEV Score with 3 ordered levels, bucketed by code; "insufficient evidence" is a FinalStatus set by policy overrides, not a risk level)
SourceStatus: pending_review | active | superseded | withdrawn
ReviewStatus: unreviewed | in_review | approved | rejected
RunStatus: queued | running | succeeded | failed | cancelled
DecisionMode (feature flag): rules_only | structured_output_baseline | jev | shadow (jev runs, logged, not used)
OrgRole: owner | admin | member | reviewer (reviewer = may approve rule_candidates, tables, chunks)

## Canonical table names (03_data_model owns columns; everyone uses these names)
organizations, users, memberships, projects, scenarios, parcels, parcel_snapshots, gis_layers, gis_layer_snapshots, gis_intersections, source_documents, document_pages, code_sections, code_chunks, source_tables, table_footnotes, rule_candidates, zoning_rules (approved rules, versioned), rule_citations, citations, table_fragments, decision_policy_versions, decision_comparisons (view), feasibility_runs, calculations, retrieval_runs, retrieval_evidence, jev_runs, briefing_runs, validation_runs, audit_events, review_tasks, gold_cases, embedding_versions

Immutable (append-only, no UPDATE/DELETE except retention policy): parcel_snapshots, gis_layer_snapshots, gis_intersections, source_documents, document_pages, code_chunks (new version = new row), source_tables, table_fragments, table_footnotes, code_sections, citations, rule_citations, embedding_versions, decision_policy_versions, zoning_rules (new version = new row), feasibility_runs, calculations, retrieval_runs, retrieval_evidence, jev_runs, briefing_runs, validation_runs, audit_events.
Mutable: organizations, users, memberships, projects, parcels (registry keyed by TAXKEY), scenarios (draft fields only; a run copies inputs), rule_candidates (until approved), review_tasks, gis_layers (registry), gold_cases (versioned via version column + immutability after freeze).

## Canonical components (02 owns diagram)
web (Next.js App Router, TypeScript), api (Next.js route handlers → service layer `packages/zoning-core`), db (PostgreSQL 16 + PostGIS 3.4 + pgvector 0.7), object storage (S3-compatible: Cloudflare R2 default), apps/worker (Node worker on pg-boss for GIS refresh, retrieval, JEV, briefing, evaluation), worker-py (Python service: PyMuPDF/pdfplumber/OCRmyPDF/Camelot parsing + embeddings), rules-engine (pure TS package, zero I/O), retrieval (hybrid: tsvector + pgvector + reranker), jev-client (feature-flagged), briefing-llm (Claude via Anthropic API, JSON schema output), validators (citation, numeric, status, action, schema), review-ui (reviewer queue inside web app, role-gated), observability (OpenTelemetry → Sentry for errors, Langfuse-style traces for model calls stored in our own tables, Grafana/Metabase eval dashboard over Postgres).

## Model roles (each: input contract / output contract / fallback / eval)
- rules-engine: input = ScenarioInputs + ParcelFacts + ApprovedRule[]; output = Finding[] with calc record; fallback = n/a (pure); eval = unit tests + gold cases.
- JEV (jev-latest via POST https://api.typesafe.ai/v1/systemone, state=JSON object, questions map; response answers.{key}.choice/.probabilities/.confidence, noul → .noul 0-1): input = PreparedDecisionState (hash logged); output = JevDecision; fallback = rules_only decision table; eval = gold-set recall/agreement/calibration/stability vs baselines.
- briefing LLM (Claude, model id claude-fable-5-1 recommended default; sonnet-5 as cheaper option): input = FrozenBriefingContract; output = BriefingOutput JSON schema; fallback = templated brief; eval = citation precision/completeness, unsupported-claim rate, status consistency, numeric alignment, abstention correctness.
- embedding model: default OpenAI text-embedding-3-large (3072→1536 truncated) OR Voyage voyage-3 — record `embedding_versions` row; re-embed on change; never mix versions in one index.
- reranker: default Cohere rerank-v3.5 via API; local bge-reranker-v2-m3 as fallback/offline option.

## v1 scope
Jurisdiction: milwaukee-wi only. Districts (Tarik, 2026-09-21, provisional pending reviewer): LB1, LB2, LB3, RB1, RB2 (Ch. 295 subchapter 6, Table 295-605-2 p. 823, 7/15/2025 stamp). Demo district: LB1 (45 ft max height makes the PRD demo concept at 46 ft a one-foot fail). All five share one use table (295-603-1) and one design-standards table, so the extra districts add rows, not new table families. Rule categories: use, height, setbacks (front/side/rear) + at most one more. Overlays/special districts: detect via GIS + registry, route to verify_before_committing unless reviewed.

## Milestones (06 owns detail)
M0 Bootstrap & contracts; M1 Parcel & map workspace (unscored scenarios); M2 Source ingestion & reviewer queue; M3 Rules engine & findings; M4 Retrieval & evidence bundle; M5 Decision layer (rules_only + shadow JEV) & briefing LLM & validators & memo; M6 Gold set 50 + evaluation dashboard + pilot readiness.
Smallest demoable slice = M0+M1+M3 (with hand-entered, reviewer-approved rules for ONE district) + templated memo on ONE real parcel; before RAG.

## Environments
local: docker compose (postgres+postgis+pgvector, minio, worker-py) ; web hosting: Vercel (apps/web) in staging and prod, or the Hetzner VPS if Tarik picks the single-box option (08 Q on deployment) ; staging: Neon (postgres w/ pgvector+postgis) or Fly Postgres + Fly apps + R2; prod: same as staging, separate project/keys. CI on GitHub Actions from M0 (typecheck, unit, build; rules-engine tests are the gate).
