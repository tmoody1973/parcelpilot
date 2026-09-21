CREATE TYPE "public"."gis_layer_kind" AS ENUM('base_zoning', 'planned_development', 'overlay', 'special_district', 'floodplain');--> statement-breakpoint
CREATE TABLE "gis_layer_snapshot_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"object_id" integer NOT NULL,
	"geometry" geometry(Geometry,4326) NOT NULL,
	"attributes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gis_layer_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gis_layer_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"feature_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"source_fields" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gis_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"kind" "gis_layer_kind" NOT NULL,
	"name" text NOT NULL,
	"service_url" text NOT NULL,
	"layer_id" integer NOT NULL,
	"expected_fields" text[] NOT NULL,
	"code_field" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gis_layer_snapshot_features" ADD CONSTRAINT "gis_layer_snapshot_features_snapshot_id_gis_layer_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."gis_layer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis_layer_snapshots" ADD CONSTRAINT "gis_layer_snapshots_gis_layer_id_gis_layers_id_fk" FOREIGN KEY ("gis_layer_id") REFERENCES "public"."gis_layers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis_layers" ADD CONSTRAINT "gis_layers_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gis_layer_snapshot_features_snapshot_idx" ON "gis_layer_snapshot_features" USING btree ("snapshot_id","object_id");--> statement-breakpoint
CREATE INDEX "gis_layer_snapshots_layer_fetched_idx" ON "gis_layer_snapshots" USING btree ("gis_layer_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gis_layers_key_idx" ON "gis_layers" USING btree ("key");