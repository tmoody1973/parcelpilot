CREATE TABLE "parcel_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxkey" text NOT NULL,
	"geometry" geometry(MultiPolygon,4326) NOT NULL,
	"attributes" jsonb NOT NULL,
	"address" text NOT NULL,
	"zoning" text,
	"lot_area_sqft" numeric,
	"lot_area_suspect" boolean DEFAULT false NOT NULL,
	"source_layer" text NOT NULL,
	"source_gis_datetime" timestamp with time zone,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcels" (
	"taxkey" text PRIMARY KEY NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parcel_snapshots" ADD CONSTRAINT "parcel_snapshots_taxkey_parcels_taxkey_fk" FOREIGN KEY ("taxkey") REFERENCES "public"."parcels"("taxkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parcel_snapshots_taxkey_hash_idx" ON "parcel_snapshots" USING btree ("taxkey","content_hash","retrieved_at");