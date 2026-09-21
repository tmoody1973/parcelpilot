CREATE TABLE "gis_intersections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parcel_snapshot_id" uuid NOT NULL,
	"gis_layer_snapshot_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"layer_key" text NOT NULL,
	"kind" "gis_layer_kind" NOT NULL,
	"code" text,
	"attributes" jsonb NOT NULL,
	"overlap_area_sqft" numeric NOT NULL,
	"overlap_ratio" numeric NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gis_intersections" ADD CONSTRAINT "gis_intersections_parcel_snapshot_id_parcel_snapshots_id_fk" FOREIGN KEY ("parcel_snapshot_id") REFERENCES "public"."parcel_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis_intersections" ADD CONSTRAINT "gis_intersections_gis_layer_snapshot_id_gis_layer_snapshots_id_fk" FOREIGN KEY ("gis_layer_snapshot_id") REFERENCES "public"."gis_layer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis_intersections" ADD CONSTRAINT "gis_intersections_feature_id_gis_layer_snapshot_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."gis_layer_snapshot_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gis_intersections_parcel_feature_idx" ON "gis_intersections" USING btree ("parcel_snapshot_id","feature_id");--> statement-breakpoint
CREATE INDEX "gis_intersections_parcel_idx" ON "gis_intersections" USING btree ("parcel_snapshot_id");