-- GIS layer registry (verified live 2026-09-21; feature counts in docs/planning/00_source_verification.md §A) + immutability + spatial index.
INSERT INTO gis_layers (key, jurisdiction_id, kind, name, service_url, layer_id, expected_fields, code_field, enabled) VALUES
  ('zoning.11', 'milwaukee-wi', 'base_zoning', 'Zoning', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 11, ARRAY['OBJECTID', 'Zoning', 'ZoningCFN', 'ZoningCategory', 'ZoningType']::text[], 'Zoning', true),
  ('zoning.12', 'milwaukee-wi', 'base_zoning', 'Zoning with downtown subdistricts', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 12, ARRAY['OBJECTID', 'Zoning', 'ZoningCFN', 'ZoningCategory', 'ZoningType']::text[], 'Zoning', false),
  ('zoning.1', 'milwaukee-wi', 'planned_development', 'Detailed planned development (DPD)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 1, ARRAY['OBJECTID', 'DPD_NAME', 'CFN', 'CFN_LINK', 'CC_ACTION_TYPE']::text[], 'DPD_NAME', true),
  ('zoning.2', 'milwaukee-wi', 'planned_development', 'General planned development (GPD)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 2, ARRAY['OBJECTID', 'GPD_NAME', 'CFN', 'CFN_LINK', 'CC_ACTION_TYPE']::text[], 'GPD_NAME', true),
  ('zoning.4', 'milwaukee-wi', 'overlay', 'Development Incentive Zones (DIZ)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 4, ARRAY['OBJECTID', 'DIZ_NAME', 'CFN', 'CFN_LINK', 'CC_ACTION_TYPE']::text[], 'DIZ_NAME', true),
  ('zoning.5', 'milwaukee-wi', 'overlay', 'Interim Study overlay zones (IS)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 5, ARRAY['OBJECTID', 'IS_NAME', 'CFN', 'IS_ID']::text[], 'IS_NAME', true),
  ('zoning.6', 'milwaukee-wi', 'overlay', 'Lakefront overlay zone', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 6, ARRAY['OBJECTID']::text[], NULL, true),
  ('zoning.7', 'milwaukee-wi', 'overlay', 'Master sign overlay zones', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 7, ARRAY['OBJECTID', 'NAME', 'BASE_ZONING', 'DIST_TYPE', 'CFN', 'CFN_LINK', 'CPC_APPROV']::text[], 'NAME', true),
  ('zoning.8', 'milwaukee-wi', 'overlay', 'Neighborhood Conservation overlay zones (NC)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 8, ARRAY['OBJECTID', 'NAME', 'CFN_APPROVE']::text[], 'NAME', true),
  ('zoning.9', 'milwaukee-wi', 'overlay', 'Site Plan Review overlay zones (SPROZ)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 9, ARRAY['OBJECTID', 'SPROD_NAME', 'CFN', 'CFN_LINK', 'CC_ACTION_TYPE']::text[], 'SPROD_NAME', true),
  ('zoning.10', 'milwaukee-wi', 'overlay', 'Shoreland/wetland overlay zones', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer', 10, ARRAY['OBJECTID', 'DIGITIZED', 'UPDATED', 'WETCODE', 'CLASS', 'MINUNIT', 'BASEDATE', 'PHOTODATE', 'ACRES']::text[], 'WETCODE', true),
  ('special_districts.6', 'milwaukee-wi', 'special_district', 'Redevelopment plans', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer', 6, ARRAY['OBJECTID', 'REDEV_NAME', 'RACM_RESOLUTION', 'DOCUMENT_ID', 'CFN', 'CFN_LINK', 'CC_ACTION_TYPE', 'COLORCAT']::text[], 'REDEV_NAME', true),
  ('special_districts.8', 'milwaukee-wi', 'special_district', 'Tax Incremental Districts (TID)', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer', 8, ARRAY['OBJECTID', 'TID', 'NAME', 'COLORCAT', 'CC_CREATE', 'CC_DISSOLV', 'CREATE_DATE', 'DISSOLVE_DATE']::text[], 'NAME', true),
  ('special_districts.17', 'milwaukee-wi', 'special_district', 'Local historic districts', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer', 17, ARRAY['OBJECTID', 'NAME', 'DES_LIST_DATE', 'CFN_NRIS', 'SHP_CHANGE']::text[], 'NAME', true),
  ('special_districts.18', 'milwaukee-wi', 'special_district', 'National historic districts', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer', 18, ARRAY['OBJECTID', 'NAME', 'DES_LIST_DATE', 'CFN_NRIS', 'SHP_CHANGE']::text[], 'NAME', true),
  ('special_districts.23', 'milwaukee-wi', 'special_district', 'Historic designation parcel classification', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer', 23, ARRAY['OBJECTID', 'HIST_CODE', 'URL']::text[], 'HIST_CODE', true),
  ('FEMA_floodplain.1', 'milwaukee-wi', 'floodplain', 'FEMA Floodway', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/FEMA_floodplain/MapServer', 1, ARRAY['OBJECTID', 'FLD_AR_ID', 'FLD_ZONE', 'FLOODWAY', 'SFHA_TF', 'V_DATUM', 'LEN_UNIT', 'VEL_UNIT', 'SOURCE_CIT', 'HYDRO_ID', 'CST_MDL_ID', 'STATIC_BFE', 'DEP_REVERT', 'BFE_REVERT', 'DEPTH', 'VELOCITY', 'AR_REVERT']::text[], 'FLD_ZONE', true),
  ('FEMA_floodplain.2', 'milwaukee-wi', 'floodplain', 'FEMA Special Flood Hazard Areas – High Risk', 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/FEMA_floodplain/MapServer', 2, ARRAY['OBJECTID', 'FLD_AR_ID', 'FLD_ZONE', 'FLOODWAY', 'SFHA_TF', 'V_DATUM', 'LEN_UNIT', 'VEL_UNIT', 'SOURCE_CIT', 'HYDRO_ID', 'CST_MDL_ID', 'STATIC_BFE', 'DEP_REVERT', 'BFE_REVERT', 'DEPTH', 'VELOCITY', 'AR_REVERT']::text[], 'FLD_ZONE', true)
ON CONFLICT (key) DO NOTHING;
-- zoning.12 is the same 148k polygons as zoning.11 plus downtown subdistricts; disabled until downtown districts are in scope.

CREATE INDEX IF NOT EXISTS gis_layer_snapshot_features_geometry_gist ON gis_layer_snapshot_features USING GIST (geometry);

CREATE TRIGGER gis_layer_snapshot_features_append_only BEFORE UPDATE OR DELETE ON gis_layer_snapshot_features FOR EACH ROW EXECUTE FUNCTION append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON gis_layer_snapshot_features FROM app_role, service_role;
-- gis_layer_snapshots: the job finalizes feature_count/content_hash inside the creating transaction only; afterwards the row is frozen.
CREATE OR REPLACE FUNCTION gis_layer_snapshots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content_hash = 'pending' AND current_setting('parcelpilot.finalizing_snapshot', true) = OLD.id::text THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'gis_layer_snapshots is append-only (% not allowed)', TG_OP USING ERRCODE = '55000';
END $$;
CREATE TRIGGER gis_layer_snapshots_append_only BEFORE UPDATE OR DELETE ON gis_layer_snapshots FOR EACH ROW EXECUTE FUNCTION gis_layer_snapshots_guard();
