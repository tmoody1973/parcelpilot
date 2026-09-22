import { sql } from "drizzle-orm";
import { boolean, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { BriefingOutcome, Criticality, DecisionMode, FinalStatus, FindingStatus, JevRoute, ModelCallStatus, ModelProvider, OrgRole, ReviewStatus, RuleCategory, RuleKind, RunStatus, SourceStatus, ValidationEffect, ValidationResult, ValidatorName } from "@parcelpilot/contracts";

// zod exposes `.options` as a plain array; drizzle wants a non-empty tuple. Values are identical.
const tuple = <T extends string>(values: readonly T[]) => values as unknown as [T, ...T[]];

// Migration groups 1–3 + audit log (docs/planning/03_data_model.md §7). GIS, rules, runs come later.
// Enum values come from @parcelpilot/contracts so the DB and the app can never disagree.

export const orgRole = pgEnum("org_role", tuple(OrgRole.options));
export const sourceStatus = pgEnum("source_status", tuple(SourceStatus.options));
export const reviewStatus = pgEnum("review_status", tuple(ReviewStatus.options));
export const sourceType = pgEnum("source_type", ["ordinance_subchapter", "ordinance_table_of_contents", "zoning_map", "amendment", "staff_guidance", "special_district_record", "comprehensive_plan", "procedure_form", "gis_layer_snapshot"]);
export const retrievalMethod = pgEnum("retrieval_method", ["browser_download", "manual_upload", "api_fetch"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---- group 2: identity and tenancy ----
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // Clerk organization id (org_...). The app maps each Clerk org onto exactly one row here on first
  // sign-in. Nullable so seed/test orgs need no Clerk id; unique so the mapping stays one-to-one.
  clerkOrgId: text("clerk_org_id"),
  plan: text("plan").notNull().default("pilot"),
  ...timestamps,
}, (t) => [uniqueIndex("organizations_slug_idx").on(t.slug), uniqueIndex("organizations_clerk_org_id_idx").on(t.clerkOrgId)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  fullName: text("full_name"),
  authProviderId: text("auth_provider_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_auth_provider_id_idx").on(t.authProviderId)]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRole("role").notNull().default("member"),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)]);

// ---- group 2b: projects and scenarios (tenant-scoped; docs/planning/03_data_model.md §4.2) ----
// A project is one development idea against one parcel. `parcel_taxkey` references the real parcels
// key (text taxkey), not the doc's aspirational `parcel_id uuid`; it is nullable because a project
// can exist before its parcel snapshot is resolved. Tenant isolation is enforced by RLS (migration 0010).
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  parcelTaxkey: text("parcel_taxkey").references(() => parcels.taxkey),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("projects_org_idx").on(t.orgId), index("projects_parcel_idx").on(t.parcelTaxkey)]);

// One proposed development concept inside a project. Draft fields are edited freely; a feasibility
// run copies them at run time so a later edit never alters a saved run.
export const scenarios = pgTable("scenarios", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  use: text("use"),
  units: integer("units"),
  heightFt: numeric("height_ft"),
  stories: integer("stories"),
  parkingSpaces: integer("parking_spaces"),
  groundFloorCommercialSqft: numeric("ground_floor_commercial_sqft"),
  draftInputs: jsonb("draft_inputs").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("draft"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
}, (t) => [index("scenarios_org_idx").on(t.orgId), index("scenarios_project_idx").on(t.projectId)]);

// ---- group 3: jurisdiction-shared sources (no org_id by design) ----
export const jurisdictions = pgTable("jurisdictions", {
  id: text("id").primaryKey(), // e.g. milwaukee-wi
  name: text("name").notNull(),
  state: text("state").notNull(),
  createdAt: timestamps.createdAt,
});

export const sourceDocuments = pgTable("source_documents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  sourceType: sourceType("source_type").notNull(),
  title: text("title").notNull(),
  officialUrl: text("official_url"),
  officialUrlVerified: boolean("official_url_verified").notNull().default(false),
  localPath: text("local_path"),
  objectKey: text("object_key"),
  sha256: text("sha256").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  retrievalMethod: retrievalMethod("retrieval_method").notNull(),
  publishedMarker: text("published_marker"), // e.g. the printed "7/15/2025" stamp
  effectiveStart: date("effective_start"),
  effectiveEnd: date("effective_end"),
  pageCount: integer("page_count"),
  status: sourceStatus("status").notNull().default("pending_review"),
  reviewStatus: reviewStatus("review_status").notNull().default("unreviewed"),
  supersedesId: uuid("supersedes_id"),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("source_documents_sha256_idx").on(t.sha256), index("source_documents_jurisdiction_status_idx").on(t.jurisdictionId, t.status)]);

// ---- audit log: append-only, enforced by trigger + REVOKE in migration 0001 ----
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id"),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  beforeHash: text("before_hash"),
  afterHash: text("after_hash"),
  payload: jsonb("payload"),
  createdAt: timestamps.createdAt,
}, (t) => [index("audit_events_org_created_idx").on(t.orgId, t.createdAt), index("audit_events_entity_idx").on(t.entityType, t.entityId)]);

// ---- group 4a: parcels (jurisdiction-shared, no org_id) ----
const multiPolygon4326 = customType<{ data: unknown; driverData: string }>({ dataType: () => "geometry(MultiPolygon,4326)" });

export const parcels = pgTable("parcels", {
  taxkey: text("taxkey").primaryKey(),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  ...timestamps,
});

// Immutable: one row per (taxkey, content_hash) observation. Enforced by the append_only trigger in migration 0003.
export const parcelSnapshots = pgTable("parcel_snapshots", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  taxkey: text("taxkey").notNull().references(() => parcels.taxkey),
  geometry: multiPolygon4326("geometry").notNull(),
  attributes: jsonb("attributes").notNull(),
  address: text("address").notNull(),
  zoning: text("zoning"),
  lotAreaSqft: numeric("lot_area_sqft"),
  lotAreaSuspect: boolean("lot_area_suspect").notNull().default(false),
  sourceLayer: text("source_layer").notNull(),
  sourceGisDatetime: timestamp("source_gis_datetime", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => [index("parcel_snapshots_taxkey_hash_idx").on(t.taxkey, t.contentHash, t.retrievedAt)]);

// ---- group 4b: GIS layer registry and snapshots (jurisdiction-shared) ----
export const gisLayerKind = pgEnum("gis_layer_kind", ["base_zoning", "planned_development", "overlay", "special_district", "floodplain"]);
const geometry4326 = customType<{ data: unknown; driverData: string }>({ dataType: () => "geometry(Geometry,4326)" });

export const gisLayers = pgTable("gis_layers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull(), // e.g. zoning.11
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  kind: gisLayerKind("kind").notNull(),
  name: text("name").notNull(),
  serviceUrl: text("service_url").notNull(), // .../planning/zoning/MapServer
  layerId: integer("layer_id").notNull(),
  expectedFields: text("expected_fields").array().notNull(),
  codeField: text("code_field"), // attribute holding the district/overlay code, when one exists
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("gis_layers_key_idx").on(t.key)]);

// One row per changed pull of a layer. Immutable (append_only trigger, migration 0006).
export const gisLayerSnapshots = pgTable("gis_layer_snapshots", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gisLayerId: uuid("gis_layer_id").notNull().references(() => gisLayers.id),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  featureCount: integer("feature_count").notNull(),
  contentHash: text("content_hash").notNull(),
  sourceFields: text("source_fields").array().notNull(),
  createdAt: timestamps.createdAt,
}, (t) => [index("gis_layer_snapshots_layer_fetched_idx").on(t.gisLayerId, t.fetchedAt)]);

export const gisLayerSnapshotFeatures = pgTable("gis_layer_snapshot_features", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotId: uuid("snapshot_id").notNull().references(() => gisLayerSnapshots.id),
  objectId: integer("object_id").notNull(),
  geometry: geometry4326("geometry"), // NULL when the source feature has no shape (it happens in City layers)
  attributes: jsonb("attributes").notNull(),
}, (t) => [index("gis_layer_snapshot_features_snapshot_idx").on(t.snapshotId, t.objectId)]);

// ---- group 4c: parcel × layer intersections (immutable; recompute = new rows only if snapshots changed) ----
export const gisIntersections = pgTable("gis_intersections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelSnapshotId: uuid("parcel_snapshot_id").notNull().references(() => parcelSnapshots.id),
  gisLayerSnapshotId: uuid("gis_layer_snapshot_id").notNull().references(() => gisLayerSnapshots.id),
  featureId: uuid("feature_id").notNull().references(() => gisLayerSnapshotFeatures.id),
  layerKey: text("layer_key").notNull(),
  kind: gisLayerKind("kind").notNull(),
  code: text("code"),
  attributes: jsonb("attributes").notNull(),
  overlapAreaSqft: numeric("overlap_area_sqft").notNull(),
  overlapRatio: numeric("overlap_ratio").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("gis_intersections_parcel_feature_idx").on(t.parcelSnapshotId, t.featureId), index("gis_intersections_parcel_idx").on(t.parcelSnapshotId)]);

// ---- group 4d: reviewed rules and citations (jurisdiction-shared, immutable; 03 §4.5) ----
export const ruleCategory = pgEnum("rule_category", tuple(RuleCategory.options));
export const ruleKind = pgEnum("rule_kind", tuple(RuleKind.options));
export const criticality = pgEnum("criticality", tuple(Criticality.options));
export const findingStatus = pgEnum("finding_status", tuple(FindingStatus.options));
export const finalStatus = pgEnum("final_status", tuple(FinalStatus.options));
export const jevRoute = pgEnum("jev_route", tuple(JevRoute.options));
export const decisionMode = pgEnum("decision_mode", tuple(DecisionMode.options));
export const runStatus = pgEnum("run_status", tuple(RunStatus.options));

// The only table a deterministic finding may cite as authority. A new version is a new row;
// `family_id` is a stable slug (e.g. lb1-height-max), not a uuid, so seeds and fixtures can name it.
// `status` is review_status (only `approved` rows are loaded by the engine); 03 wrote source_status,
// which describes documents, not reviews.
export const zoningRules = pgTable("zoning_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: text("family_id").notNull(),
  version: integer("version").notNull(),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  districtCode: text("district_code").notNull(),
  category: ruleCategory("category").notNull(),
  kind: ruleKind("kind").notNull(),
  params: jsonb("params").notNull(),
  conditions: jsonb("conditions").notNull().default(sql`'[]'::jsonb`),
  criticality: criticality("criticality").notNull(),
  status: reviewStatus("status").notNull().default("unreviewed"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  supersedesId: uuid("supersedes_id"),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("zoning_rules_family_version_idx").on(t.familyId, t.version), index("zoning_rules_district_category_idx").on(t.jurisdictionId, t.districtCode, t.category)]);

// One evidence pointer: this document, this page, this excerpt. code_chunk_id gets its FK in M2.
export const citations = pgTable("citations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  codeChunkId: uuid("code_chunk_id"),
  documentPageId: uuid("document_page_id"), // FK added in migration 0013 (document_pages is declared later in this file)
  sourceDocumentId: uuid("source_document_id").notNull().references(() => sourceDocuments.id),
  pageNumber: integer("page_number").notNull(),
  printedPage: integer("printed_page"),
  section: text("section"),
  anchor: text("anchor"),
  excerpt: text("excerpt").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => [index("citations_document_page_idx").on(t.sourceDocumentId, t.pageNumber)]);

export const ruleCitations = pgTable("rule_citations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  zoningRuleId: uuid("zoning_rule_id").notNull().references(() => zoningRules.id),
  citationId: uuid("citation_id").notNull().references(() => citations.id),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("rule_citations_rule_citation_idx").on(t.zoningRuleId, t.citationId)]);

// ---- group 5: feasibility runs and calculations (tenant-scoped, immutable once locked; 03 §4.6) ----
// A run pins every id the result depends on. Rows may be updated only until `locked_at` is set
// (status queued → running → succeeded, then final_status + locked_at); after that, frozen (migration 0012).
export const feasibilityRuns = pgTable("feasibility_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id),
  parcelSnapshotId: uuid("parcel_snapshot_id").notNull().references(() => parcelSnapshots.id),
  gisLayerSnapshotIds: uuid("gis_layer_snapshot_ids").array().notNull(),
  inputHash: text("input_hash").notNull(),
  scenarioInputs: jsonb("scenario_inputs").notNull(),
  ruleVersionSet: jsonb("rule_version_set").notNull(),
  decisionMode: decisionMode("decision_mode").notNull().default("rules_only"),
  status: runStatus("status").notNull().default("queued"),
  finalStatus: finalStatus("final_status"),
  route: jevRoute("route"),
  policyReasons: jsonb("policy_reasons"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  decisionPolicyVersionId: uuid("decision_policy_version_id").references(() => decisionPolicyVersions.id), // migration 0019; null on runs before M5
  goldCaseId: text("gold_case_id"), // set only on gold-case runs, with the expert label copied from the gold file
  goldCaseVersion: integer("gold_case_version"),
  goldExpectedStatus: finalStatus("gold_expected_status"),
  goldExpectedRoute: jevRoute("gold_expected_route"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamps.createdAt,
}, (t) => [index("feasibility_runs_org_project_idx").on(t.orgId, t.projectId), index("feasibility_runs_scenario_idx").on(t.scenarioId)]);

// One finding per rule category within a run: the engine's Finding plus its calculation records.
export const calculations = pgTable("calculations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feasibilityRunId: uuid("feasibility_run_id").notNull().references(() => feasibilityRuns.id),
  ruleCategory: ruleCategory("rule_category").notNull(),
  findingStatus: findingStatus("finding_status").notNull(),
  criticality: criticality("criticality").notNull(),
  proposedValue: jsonb("proposed_value"),
  allowedValue: jsonb("allowed_value"),
  assumptions: jsonb("assumptions").notNull().default(sql`'[]'::jsonb`),
  calculationDetail: jsonb("calculation_detail").notNull(),
  zoningRuleId: uuid("zoning_rule_id").references(() => zoningRules.id),
  citationIds: uuid("citation_ids").array().notNull().default(sql`'{}'::uuid[]`),
  confidence: text("confidence").notNull(),
  reviewReason: text("review_reason"),
  createdAt: timestamps.createdAt,
}, (t) => [index("calculations_run_idx").on(t.feasibilityRunId)]);

// ---- group 4e: the zoning-code corpus (jurisdiction-shared, immutable; 03 §4.4, 04 §3.6) ----
// A code revision produces new rows under a new source_documents row; nothing here is ever edited.
const vector1536 = customType<{ data: number[] | null; driverData: string }>({ dataType: () => "vector(1536)" });
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => "tsvector" });
export const chunkKind = pgEnum("chunk_kind", ["operative_provision", "table_row", "table_header", "footnote", "definition", "exception", "purpose_statement", "procedure"]);
export const codeSourceType = pgEnum("code_source_type", ["ordinance_text", "table_row", "footnote", "definition", "amendment", "map_legend"]);
export const reviewTaskType = pgEnum("review_task_type", ["rule_candidate_review", "merge_review", "page_review", "footnote_review", "source_review", "gis_ambiguity"]);

export const documentPages = pgTable("document_pages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => sourceDocuments.id),
  pageNumber: integer("page_number").notNull(),
  printedPage: integer("printed_page"),
  rawText: text("raw_text").notNull(),
  charDensity: numeric("char_density"), // native characters per page area; below threshold → OCR
  ocrConfidence: numeric("ocr_confidence"), // null when native text was used
  imageRef: text("image_ref"), // object storage key of the rendered page
  contentHash: text("content_hash").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("document_pages_doc_page_idx").on(t.sourceDocumentId, t.pageNumber)]);

export const codeSections = pgTable("code_sections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => sourceDocuments.id),
  chapter: text("chapter").notNull(),
  subchapter: text("subchapter"),
  section: text("section").notNull(), // e.g. 295-603-2-a-2
  subsection: text("subsection"),
  heading: text("heading").notNull(),
  parentSectionId: uuid("parent_section_id"),
  pageStart: integer("page_start"),
  sortOrder: integer("sort_order").notNull(),
  confidence: text("confidence").notNull().default("high"), // low → page_review task
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("code_sections_doc_section_sort_idx").on(t.sourceDocumentId, t.section, t.sortOrder), index("code_sections_section_idx").on(t.sourceDocumentId, t.section)]);

export const embeddingVersions = pgTable("embedding_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  dimension: integer("dimension").notNull(),
  truncatedFrom: integer("truncated_from"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamps.createdAt,
});

// The retrievable unit (PRD §10.4 C). family_id is deterministic from (document sha, section, ordinal).
export const codeChunks = pgTable("code_chunks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: text("family_id").notNull(),
  version: integer("version").notNull(),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  codeFamily: text("code_family").notNull().default("zoning"),
  chapter: text("chapter").notNull(),
  subchapter: text("subchapter"),
  section: text("section").notNull(),
  subsection: text("subsection"),
  heading: text("heading"),
  sourceType: codeSourceType("source_type").notNull(),
  districtCodes: text("district_codes").array().notNull().default(sql`'{}'::text[]`),
  overlayCodes: text("overlay_codes").array().notNull().default(sql`'{}'::text[]`),
  ruleCategories: ruleCategory("rule_categories").array().notNull().default(sql`'{}'::rule_category[]`),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => sourceDocuments.id),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end"),
  text: text("text").notNull(),
  tableJson: jsonb("table_json"),
  parentSectionId: uuid("parent_section_id").references(() => codeSections.id),
  precedingChunkId: uuid("preceding_chunk_id"),
  followingChunkId: uuid("following_chunk_id"),
  crossReferenceIds: uuid("cross_reference_ids").array().notNull().default(sql`'{}'::uuid[]`),
  status: sourceStatus("status").notNull().default("pending_review"),
  reviewerStatus: reviewStatus("reviewer_status").notNull().default("unreviewed"),
  effectiveStart: date("effective_start"),
  effectiveEnd: date("effective_end"),
  supersedesId: uuid("supersedes_id"),
  embedding: vector1536("embedding"),
  embeddingVersionId: uuid("embedding_version_id").references(() => embeddingVersions.id),
  // Generated in migration 0017: prose through the zoning_code config plus section/table numbers as whole lexemes.
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('zoning_code'::regconfig, coalesce(heading, '') || ' ' || text) || zoning_code_tokens(coalesce(section, '') || ' ' || coalesce(heading, '') || ' ' || text)`),
  chunkKind: chunkKind("chunk_kind").generatedAlwaysAs(sql`(see migration 0017)`),
  tokenCount: integer("token_count").generatedAlwaysAs(sql`ceil(char_length(text) / 4.0)::integer`),
  textHash: text("text_hash").generatedAlwaysAs(sql`md5(text)`),
  sourceAnchors: jsonb("source_anchors").generatedAlwaysAs(sql`(see migration 0017)`),
  createdAt: timestamps.createdAt,
}, (t) => [
  uniqueIndex("code_chunks_family_version_idx").on(t.familyId, t.version),
  index("code_chunks_doc_page_idx").on(t.sourceDocumentId, t.pageStart),
  index("code_chunks_tsv_idx").using("gin", t.tsv),
  index("code_chunks_district_idx").using("gin", t.districtCodes),
  index("code_chunks_categories_idx").using("gin", t.ruleCategories),
]);

// One logical table (possibly spanning pages) with canonical rows carrying row-level provenance (04 §3.6).
export const sourceTables = pgTable("source_tables", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => sourceDocuments.id),
  familyKey: text("family_key").notNull(), // e.g. tbl_295_605_2
  caption: text("caption"),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  canonicalRows: jsonb("canonical_rows").notNull().default(sql`'[]'::jsonb`),
  columnSchema: jsonb("column_schema").notNull().default(sql`'[]'::jsonb`), // normalized district columns
  mergeReviewStatus: reviewStatus("merge_review_status").notNull().default("unreviewed"),
  extractor: text("extractor").notNull(), // docling | camelot_lattice | camelot_stream | pdfplumber | manual
  metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("source_tables_doc_family_idx").on(t.sourceDocumentId, t.familyKey)]);

export const tableFragments = pgTable("table_fragments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceTableId: uuid("source_table_id").notNull().references(() => sourceTables.id),
  documentPageId: uuid("document_page_id").notNull().references(() => documentPages.id),
  pageNumber: integer("page_number").notNull(),
  bbox: jsonb("bbox").notNull(), // { x0, y0, x1, y1 } in page points
  headers: jsonb("headers").notNull(),
  rows: jsonb("rows").notNull(),
  extractor: text("extractor").notNull(),
  continuationSignals: jsonb("continuation_signals").notNull().default(sql`'[]'::jsonb`), // which 04 §3.6 signals fired
  createdAt: timestamps.createdAt,
}, (t) => [index("table_fragments_table_idx").on(t.sourceTableId, t.pageNumber)]);

export const tableFootnotes = pgTable("table_footnotes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceTableId: uuid("source_table_id").notNull().references(() => sourceTables.id),
  fragmentId: uuid("fragment_id").references(() => tableFragments.id),
  marker: text("marker").notNull(), // *, **, 1, a
  text: text("text").notNull(),
  appliesToRowKeys: text("applies_to_row_keys").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamps.createdAt,
}, (t) => [index("table_footnotes_table_idx").on(t.sourceTableId)]);

// ---- group 4f: the reviewer queue (jurisdiction-shared, mutable until resolved; 03 §4.5, §4.7) ----
// A candidate is extracted by code from a canonical row. It can never drive a finding; approval inserts a zoning_rules row.
export const ruleCandidates = pgTable("rule_candidates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  familyId: text("family_id").notNull(), // becomes zoning_rules.family_id on approval
  districtCode: text("district_code").notNull(),
  category: ruleCategory("category").notNull(),
  proposedRule: jsonb("proposed_rule").notNull(), // contracts ZoningRule shape minus id/status
  extractedValue: jsonb("extracted_value").notNull(), // the raw cell(s) as pulled
  sourceTableId: uuid("source_table_id").references(() => sourceTables.id),
  rowKey: text("row_key"),
  sourceChunkIds: uuid("source_chunk_ids").array().notNull().default(sql`'{}'::uuid[]`),
  citationIds: uuid("citation_ids").array().notNull().default(sql`'{}'::uuid[]`),
  extractionMethod: text("extraction_method").notNull(), // table_row | manual
  reviewerStatus: reviewStatus("reviewer_status").notNull().default("unreviewed"),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  reviewerNotes: text("reviewer_notes"),
  approvedRuleId: uuid("approved_rule_id").references(() => zoningRules.id),
  ...timestamps,
}, (t) => [index("rule_candidates_district_category_idx").on(t.jurisdictionId, t.districtCode, t.category), index("rule_candidates_status_idx").on(t.reviewerStatus)]);

export const reviewTasks = pgTable("review_tasks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jurisdictionId: text("jurisdiction_id").notNull().references(() => jurisdictions.id),
  taskType: reviewTaskType("task_type").notNull(),
  entityType: text("entity_type").notNull(), // rule_candidate | source_table | document_page | table_footnote | source_document
  entityId: uuid("entity_id").notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: reviewStatus("status").notNull().default("unreviewed"),
  priority: criticality("priority"),
  reason: text("reason"), // required on reject / edit
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("review_tasks_entity_idx").on(t.taskType, t.entityType, t.entityId), index("review_tasks_status_idx").on(t.status, t.taskType)]);

// ---- group 4c: retrieval (migration 0017; 03 §4.6). Tenant-scoped with RLS; org_id null only for offline evaluation runs. ----
export const retrievalRuns = pgTable("retrieval_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  feasibilityRunId: uuid("feasibility_run_id").references(() => feasibilityRuns.id),
  orgId: uuid("org_id").references(() => organizations.id),
  subquestion: text("subquestion").notNull(),
  category: ruleCategory("category"),
  filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
  embeddingVersionId: uuid("embedding_version_id").references(() => embeddingVersions.id),
  rerankerModel: text("reranker_model"),
  plannerVersion: text("planner_version").notNull(),
  status: runStatus("status").notNull().default("succeeded"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (t) => [index("retrieval_runs_feasibility_idx").on(t.feasibilityRunId), index("retrieval_runs_org_idx").on(t.orgId, t.createdAt)]);

export const retrievalEvidence = pgTable("retrieval_evidence", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  retrievalRunId: uuid("retrieval_run_id").notNull().references(() => retrievalRuns.id),
  orgId: uuid("org_id").references(() => organizations.id),
  codeChunkId: uuid("code_chunk_id").notNull().references(() => codeChunks.id),
  rank: integer("rank").notNull(),
  lexicalScore: numeric("lexical_score"),
  semanticScore: numeric("semantic_score"),
  rerankScore: numeric("rerank_score"),
  relevanceScore: numeric("relevance_score"),
  selectionReason: text("selection_reason").notNull(),
  requiredContextType: text("required_context_type"),
  requiredContextFound: boolean("required_context_found").notNull().default(true),
  anchors: jsonb("anchors").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("retrieval_evidence_run_rank_unique").on(t.retrievalRunId, t.rank), index("retrieval_evidence_run_idx").on(t.retrievalRunId)]);

// ---- group 5 continued: the decision layer's logs (migration 0019; 05 §4.8, §7, §8). Tenant-scoped, append-only. ----
export const modelProvider = pgEnum("model_provider", tuple(ModelProvider.options));
export const modelCallStatus = pgEnum("model_call_status", tuple(ModelCallStatus.options));
export const briefingOutcome = pgEnum("briefing_outcome", tuple(BriefingOutcome.options));
export const validationResult = pgEnum("validation_result", tuple(ValidationResult.options));
export const validationEffect = pgEnum("validation_effect", tuple(ValidationEffect.options));
export const validatorName = pgEnum("validator_name", tuple(ValidatorName.options));

// Product-wide, never edited; the repo copy (DECISION_POLICY_V1) is the authority and the seed must match it.
export const decisionPolicyVersions = pgTable("decision_policy_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  version: text("version").notNull().unique(),
  config: jsonb("config").notNull(),
  createdAt: timestamps.createdAt,
});

export const jevRuns = pgTable("jev_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feasibilityRunId: uuid("feasibility_run_id").notNull().references(() => feasibilityRuns.id),
  provider: modelProvider("provider").notNull(),
  decisionMode: decisionMode("decision_mode").notNull(),
  inputState: jsonb("input_state").notNull(),
  inputStateHash: text("input_state_hash").notNull(),
  questionSetVersion: text("question_set_version").notNull(),
  modelVersion: text("model_version"),
  rawResponse: jsonb("raw_response"),
  answers: jsonb("answers"),
  recommendedRoute: jevRoute("recommended_route"),
  routeConfidence: numeric("route_confidence"),
  status: modelCallStatus("status").notNull(),
  error: text("error"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costEstimateUsd: numeric("cost_estimate_usd"),
  usedByPolicy: boolean("used_by_policy").notNull().default(false),
  createdAt: timestamps.createdAt,
}, (t) => [index("jev_runs_feasibility_idx").on(t.feasibilityRunId, t.provider, t.createdAt)]);

export const briefingRuns = pgTable("briefing_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feasibilityRunId: uuid("feasibility_run_id").notNull().references(() => feasibilityRuns.id),
  contract: jsonb("contract").notNull(),
  contractHash: text("contract_hash").notNull(),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  modelVersion: text("model_version"),
  rawOutput: text("raw_output"),
  validatedOutput: jsonb("validated_output"),
  outcome: briefingOutcome("outcome").notNull(),
  error: text("error"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costEstimateUsd: numeric("cost_estimate_usd"),
  createdAt: timestamps.createdAt,
}, (t) => [index("briefing_runs_feasibility_idx").on(t.feasibilityRunId, t.createdAt)]);

export const validationRuns = pgTable("validation_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  briefingRunId: uuid("briefing_run_id").notNull().references(() => briefingRuns.id),
  validator: validatorName("validator").notNull(),
  result: validationResult("result").notNull(),
  effect: validationEffect("effect").notNull().default("none"),
  removedSentenceIds: text("removed_sentence_ids").array().notNull().default(sql`'{}'::text[]`),
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("validation_runs_one_per_validator").on(t.briefingRunId, t.validator)]);
