// Thin client for the City of Milwaukee ArcGIS REST services (verified 2026-09-21, docs/planning/00_source_verification.md §A).
// Plain fetch on purpose: two endpoints, injectable for tests, no SDK.

export const ARCGIS_BASE = "https://milwaukeemaps.milwaukee.gov/arcgis/rest/services";
export const PARCEL_LAYER = `${ARCGIS_BASE}/property/parcels_mprop/MapServer/2`;
export const GEOCODER = `${ARCGIS_BASE}/LocatorV11/Top_1/GeocodeServer`; // Locator/Address needs the odd "Single Line Input" param; Top_1 takes SingleLine
export const PARCEL_OUT_FIELDS = ["TAXKEY", "HOUSE_NR_LO", "HOUSE_NR_HI", "SDIR", "STREET", "STTYPE", "UNIT", "ZONING", "LOT_AREA", "CORNER_LOT", "NR_UNITS", "NR_STORIES", "BLDG_AREA", "LAND_USE", "LAND_USE_GP", "YR_BUILT", "HIST_CODE", "PARCEL_TYPE", "GIS_DATETIME"] as const;

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export type ParcelFeature = { type: "Feature"; geometry: GeoJsonPolygon; properties: Record<string, unknown> };
export type ParcelFeatureCollection = { type: "FeatureCollection"; features: ParcelFeature[] };
export type GeocodeCandidate = { address: string; score: number; location: { x: number; y: number } };

async function getJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`ArcGIS ${res.status} for ${url}`);
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (body && typeof body === "object" && "error" in body && body.error) throw new Error(`ArcGIS error: ${body.error.message ?? "unknown"}`);
  return body;
}

export function createArcgisClient(fetchImpl: FetchLike = (u) => fetch(u)) {
  const outFields = PARCEL_OUT_FIELDS.join(",");
  return {
    async geocode(singleLine: string, maxLocations = 5): Promise<GeocodeCandidate[]> {
      const q = new URLSearchParams({ SingleLine: singleLine, outSR: "4326", maxLocations: String(maxLocations), f: "json" });
      const body = await getJson<{ candidates?: GeocodeCandidate[] }>(fetchImpl, `${GEOCODER}/findAddressCandidates?${q}`);
      return body.candidates ?? [];
    },
    async parcelsByTaxkey(taxkey: string): Promise<ParcelFeatureCollection> {
      const q = new URLSearchParams({ where: `TAXKEY='${taxkey.replace(/[^0-9A-Za-z]/g, "")}'`, outFields, returnGeometry: "true", outSR: "4326", f: "geojson" });
      return getJson<ParcelFeatureCollection>(fetchImpl, `${PARCEL_LAYER}/query?${q}`);
    },
    async parcelsAtPoint(lon: number, lat: number): Promise<ParcelFeatureCollection> {
      const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields, returnGeometry: "true", outSR: "4326", f: "geojson" });
      return getJson<ParcelFeatureCollection>(fetchImpl, `${PARCEL_LAYER}/query?${q}`);
    },
  };
}
export type ArcgisClient = ReturnType<typeof createArcgisClient>;
