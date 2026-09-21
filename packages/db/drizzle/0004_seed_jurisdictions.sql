-- Reference data every environment needs before any parcel can be stored. Idempotent.
INSERT INTO jurisdictions (id, name, state) VALUES ('milwaukee-wi', 'City of Milwaukee', 'WI') ON CONFLICT (id) DO NOTHING;
