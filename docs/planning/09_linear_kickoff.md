# 09 — Linear kickoff: ParcelPilot vertical slice (M0 + blockers)

**Status:** CREATED in Linear 2026-09-21 (team Moodyco). Project: https://linear.app/moodyco/project/parcelpilot-vertical-slice-202f70abc79e
**How to use:** in a session where the Linear MCP server is loaded, run `/linear-build` and say "kickoff from docs/planning/09_linear_kickoff.md". The skill will list teams, check for a duplicate project, show this plan, and create it on a yes.
**Source:** `06_delivery_plan.md` M0 exit criteria; `08_open_questions.md` top-3 blockers; `00_conventions.md` names.

## Project

**Name:** ParcelPilot — vertical slice
**Goal:** One real Milwaukee LB1 parcel goes from address search to a page-cited preliminary zoning screen with a conservative status, using hand-reviewed rules, before any retrieval or model is wired in.
**Done when:** the demo parcel's `gold_cases` row passes in CI (exact match on findings and `FinalStatus`) and the domain reviewer has signed off on the rendered memo language.
**Milestones covered:** M0 now; M1 and M3 issues added when M0 exits.

## Issues, in dependency order

### 1. Decide: confirm v1 districts (LB1, LB2, LB3, RB1, RB2)  ·  **MOO-794**
**Assignee:** Tarik · **Label:** decision
**Intent.** Lock the districts the first slice supports so rules and gold cases can be authored. Tarik's provisional pick is LB1, LB2, LB3, RB1, RB2; LB1 is the demo district.
**Acceptance criteria**
- [ ] Domain reviewer confirms or amends the five districts in writing.
- [ ] Demo district confirmed (default LB1).
- [ ] `00_conventions.md` v1 scope line updated to "confirmed".
**Verification checklist**
- [ ] Reviewer's confirmation is linked or quoted in a comment on this issue.
- [ ] `docs/decisions/007-target-districts.md` exists with the reasoning.
**Out of scope.** Residential RM districts, downtown C9 districts, overlays.

### 2. Decide: recruit the domain reviewer  ·  **MOO-795**
**Assignee:** Tarik · **Label:** decision
**Intent.** Every executable rule, table merge, and gold label needs a qualified human. Without one, no `pass` result can exist by design.
**Acceptance criteria**
- [ ] A named planner, architect, or zoning attorney has agreed in writing.
- [ ] Hours per week, compensation, and approval authority (which `ReviewStatus` transitions they own) are recorded.
- [ ] They have a user row with `OrgRole = reviewer`.
**Verification checklist**
- [ ] Agreement text or email is attached or summarized in a comment.
- [ ] `08_open_questions.md` reviewer question marked answered.
**Out of scope.** Second reviewer for critical rules (decide after first 15 gold cases).

### 3. Decide: deployment shape  ·  **MOO-796**
**Assignee:** Tarik · **Label:** decision
**Intent.** Pick between Vercel + Fly.io + Neon + R2 and a single Hetzner box with docker compose. This sets object storage, CI deploy steps, and cost.
**Acceptance criteria**
- [ ] One option chosen with a one-line reason.
- [ ] Object storage provider follows from it (R2 or Hetzner Object Storage).
- [ ] `02_architecture.md` decision #14 and `00_conventions.md` Environments updated.
**Verification checklist**
- [ ] `docs/decisions/008-deployment-shape.md` written with options and cost.
**Out of scope.** Multi-region, SSO, billing.

### 4. Bootstrap the pnpm monorepo  ·  **MOO-797**
**Label:** M0
**Intent.** One repo skeleton every later milestone builds on, with the package boundaries from `02_architecture.md` §1.
**Acceptance criteria**
- [ ] `apps/web` (Next.js 15 App Router, TypeScript strict), `apps/worker`, `packages/zoning-core`, `packages/rules-engine`, `packages/db`, `packages/contracts`, `services/worker-py` exist with a README line each.
- [ ] `pnpm install && pnpm typecheck && pnpm build` succeed from a fresh clone.
- [ ] ESLint rule forbids any I/O import inside `packages/rules-engine`.
**Verification checklist**
- [ ] Fresh-clone terminal transcript of install, typecheck, build attached.
- [ ] A deliberate `fs` import in `packages/rules-engine` fails lint; revert shown.
**Out of scope.** Any feature code, UI, or schema.

### 5. CI on day one, proven red  ·  **MOO-798**
**Label:** M0 · **Depends on:** 4
**Intent.** A GitHub Actions workflow that runs typecheck, unit tests, and build on every push and pull request, proven to fail when a test breaks.
**Acceptance criteria**
- [ ] `.github/workflows/ci.yml` runs on push to `main` and on PRs.
- [ ] One test deliberately broken produced a red run; revert produced green.
- [ ] Branch protection on `main` requires the check (manual GitHub settings step, done by Tarik).
**Verification checklist**
- [ ] Links to the red run and the green run in a comment.
- [ ] Screenshot of branch-protection rule.
**Out of scope.** Deploy steps, gold-set eval job (M3+).

### 6. Local environment via docker compose  ·  **MOO-799**
**Label:** M0 · **Depends on:** 4
**Intent.** `docker compose up` gives a working PostgreSQL 16 with PostGIS 3.4 and pgvector 0.7, MinIO, and `worker-py` from a fresh clone with no manual steps.
**Acceptance criteria**
- [ ] `docker compose up -d` succeeds on a clean machine.
- [ ] `SELECT postgis_version(), extversion FROM pg_extension WHERE extname='vector'` returns values.
- [ ] MinIO console reachable; `worker-py` health endpoint returns 200.
**Verification checklist**
- [ ] `docker compose ps` output and the SQL result pasted in a comment.
**Out of scope.** Staging or production infrastructure (issue 3).

### 7. Shared contracts and the DecisionMode flag  ·  **MOO-800**
**Label:** M0 · **Depends on:** 4
**Intent.** The canonical enums and the feature flag exist as code so every package uses the same names, and the safe default is enforced.
**Acceptance criteria**
- [ ] `packages/contracts` exports zod schemas for every enum in `00_conventions.md` (FinalStatus, FindingStatus, Criticality, RuleCategory, CoverageBucket, JevRoute, JevRisk, SourceStatus, ReviewStatus, RunStatus, DecisionMode, OrgRole) and emits JSON Schema files consumed by `worker-py`.
- [ ] `DecisionMode` reads from env and DB override, defaults to `rules_only`.
- [ ] Banned-phrase lint (approved, fully compliant, by right, permitted, compliant as a verdict) runs in CI over UI strings and templates.
**Verification checklist**
- [ ] Unit test proves default is `rules_only` when no config is set.
- [ ] A test string containing "by right" fails the lint; shown in CI.
**Out of scope.** JEV client, briefing client.

### 8. Schema migrations groups 1–3, RLS, append-only audit log  ·  **MOO-801**
**Label:** M0 · **Depends on:** 6, 7
**Intent.** The first three migration groups from `03_data_model.md` §7 (extensions; organizations, users, memberships; jurisdictions and `source_documents`) plus `audit_events` and Row Level Security so tenancy is enforced from the first row.
**Acceptance criteria**
- [ ] Drizzle SQL migrations committed; `pnpm db:migrate` applies cleanly on the compose database.
- [ ] RLS enabled with a policy on every table that has `org_id`.
- [ ] `audit_events` rejects UPDATE and DELETE via trigger.
**Verification checklist**
- [ ] The trip-wire query from `03` §6 returns zero rows, pasted in a comment.
- [ ] A test connecting as `app_role` with a wrong `app.org_id` sees zero project rows.
- [ ] An attempted `UPDATE audit_events` raises; error text pasted.
**Out of scope.** GIS, rules, runs tables (M1/M3 migrations).

### 9. Seed the source registry from `data/`  ·  **MOO-802**
**Label:** M0 · **Depends on:** 6, 8
**Intent.** The twelve local Chapter 295 PDFs become real `source_documents` rows with hashes, page counts, and printed date stamps, stored immutably, so ingestion in M2 starts from a registry, not a folder.
**Acceptance criteria**
- [ ] Each PDF uploaded to object storage under `milwaukee-wi/ordinance_subchapter/{sha256}.pdf`.
- [ ] Twelve `source_documents` rows with `status = pending_review`, `retrieval_method = manual_upload`, `published_marker` from the first-page date stamp, `page_count`, `sha256`, `official_url` marked unverified.
- [ ] Plans, forms, and incentives registered as rows with `source_type` set and no ingestion.
**Verification checklist**
- [ ] `SELECT source_type, page_count, published_marker, status FROM source_documents ORDER BY 1,2` output pasted; page counts match `00_source_verification.md`.
- [ ] Re-running the seed is idempotent (row count unchanged).
**Out of scope.** Parsing, chunking, review queue (M2).

### 10. First 15 gold cases  ·  **MOO-803**
**Label:** M0 · **Depends on:** 1, 2, 8
**Intent.** Reviewer-authored expected outcomes for LB1 and LB2 scenarios, including the demo parcel, so the rules engine in M3 has a finish line before it exists.
**Acceptance criteria**
- [ ] 15 `gold_cases` rows (or JSON fixtures until the table lands) with parcel facts, scenario, expected findings per category, expected `FinalStatus`, expected triggers, required citations (page-level into subchapter 6).
- [ ] Mix per PRD §9.2: straightforward pass, height fail, density fail, street-level dwelling condition, stacked condo, missing input, overlay hit.
- [ ] Reviewer sign-off recorded as a `review_tasks` row or a signed comment.
**Verification checklist**
- [ ] Each case cites a page in `CH295-sub6.pdf` that a second person opened and confirmed.
- [ ] Two reviewers disagree on at least zero cases; where they disagree, both labels are kept and the safer route is the expected one.
**Out of scope.** Cases 16–50 (M6).

## M1 (created 2026-09-21, all Done except staging)
MOO-804 GIS layer registry · MOO-805 parcel resolver · MOO-806 GIS intersections · MOO-807 auth + projects + scenarios · MOO-808 workspace UI · MOO-809 staging (open, needs accounts).

## M3 (created 2026-09-21; all eight Done the same day)
Rules for LB1 **and** LB2 (the gold set G06–G08 is LB2). Memo is HTML with a print stylesheet; a PDF library waits for M5. Policy lives in `zoning-core` but is a pure function like the engine. Built in order by Claude; no `ready-for-agent` labels. Exit: `pnpm test:gold` 15/15 in CI (required check `gold-cases`), demo parcel scored live and memo rendered with page citations (`pnpm gold:live`). Open before the project done-when is met: the interim reviewer reads the rendered memo (MOO-803 sign-off).

| # | Issue | Depends on |
|---|---|---|
| MOO-810 | Rules engine core — rule kinds, `evaluate()`, coverage buckets | — |
| MOO-811 | Schema group 4 — `zoning_rules`, `citations`, `rule_citations`, `feasibility_runs`, `calculations` | MOO-801 |
| MOO-812 | Final status policy — hard overrides, rules-only table, citation gate, never-more-permissive test | MOO-810 |
| MOO-813 | Hand-entered LB1 + LB2 rules with page citations into CH295-sub6 (reviewer signs) | MOO-811 |
| MOO-814 | Run orchestration — `feasibility_runs` from a saved scenario, locked status | 810, 811, 812, 813 |
| MOO-815 | Findings, coverage, and status panels in the workspace | MOO-814 |
| MOO-816 | Templated memo with disclaimer, provenance, page citations | MOO-814 |
| MOO-817 | Gold-case CI — all 15 exact-match, demo case live end to end | 810, 812, 813, 814 |

## M2 (created 2026-09-21, in dependency order)
Sources: 06 M2, PRD §10.4 B/C, 03 §4.4, 04 §3.6 and §10, decisions 002/003, 08 Q-05. Tarik's calls: all eight; first queue-approved rules for LB3, RB1, RB2; `CH295-sub6.pdf` committed as a CI fixture (public City document). The pipeline's proof is reproducing the 14 signed LB1/LB2 values from the extracted table.

| # | Issue | Depends on |
|---|---|---|
| MOO-818 | Schema group 4b — pages, sections, chunks, tables, fragments, footnotes, candidates, review tasks; `active_code_chunks` view | MOO-811 |
| MOO-820 | Page extraction in worker-py — text, density, page images, OCR path; all 12 subchapters | MOO-818 |
| MOO-822 | Docling evaluation spike on Tables 295-505-2 and 295-605-2 (decision 009) | MOO-820 |
| MOO-823 | Structure and chunks — section tree, chunks with neighbors, tags, full-text; sub6 chunked in CI | MOO-820 |
| MOO-824 | Table families — multi-page reconstruction with footnotes; reproduces the 14 signed values | 818, 820, 822 |
| MOO-819 | Review queue backend — tasks, role gate, approval mints a versioned rule, source lifecycle | MOO-818 |
| MOO-821 | Reviewer UI — queue, page-level viewer, candidate editor, approve / edit / reject with reason | MOO-819 |
| MOO-825 | First queue-born rules — LB3, RB1, RB2 candidates, LB1/LB2 reconciled, footnote policy (decision 010) | 824, 819, 821 |
