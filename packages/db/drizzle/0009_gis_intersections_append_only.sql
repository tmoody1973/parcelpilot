CREATE TRIGGER gis_intersections_append_only BEFORE UPDATE OR DELETE ON gis_intersections FOR EACH ROW EXECUTE FUNCTION append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON gis_intersections FROM app_role, service_role;
