import { sql } from "drizzle-orm";
import { boolean, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { OrgRole, ReviewStatus, SourceStatus } from "@parcelpilot/contracts";

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
  plan: text("plan").notNull().default("pilot"),
  ...timestamps,
}, (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  fullName: text("full_name"),
  authProviderId: text("auth_provider_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRole("role").notNull().default("member"),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)]);

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
