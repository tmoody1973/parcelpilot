"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MlMap, NavigationControl, type GeoJSONSource, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import type { GeoJsonPolygon, GisFeature } from "../lib/dto.ts";

// OpenStreetMap raster basemap — no API key, fine for the M1 demo. Swap for a vector provider before launch.
const BASEMAP: StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const MILWAUKEE: [number, number] = [-87.9065, 43.0389];

function bounds(geometry: GeoJsonPolygon): LngLatBounds {
  const b = new LngLatBounds();
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) for (const [lon, lat] of ring) b.extend([lon as number, lat as number]);
  return b;
}

// Colour per layer kind for the intersecting-layer context (PRD P-06: draw only what touches the parcel).
const KIND_COLOR = ["match", ["get", "kind"], "planned_development", "#b45309", "overlay", "#7c3aed", "special_district", "#0f766e", "floodplain", "#0369a1", "#6b7280"] as const;

export function ParcelMap({ geometry, features = [], onPick }: { geometry: GeoJsonPolygon | null; features?: GisFeature[]; onPick: (point: { lon: number; lat: number }) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MlMap({ container: container.current, style: BASEMAP, center: MILWAUKEE, zoom: 11 });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("context", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "context-fill", type: "fill", source: "context", paint: { "fill-color": KIND_COLOR as never, "fill-opacity": 0.12 } });
      m.addLayer({ id: "context-line", type: "line", source: "context", paint: { "line-color": KIND_COLOR as never, "line-width": 1.5, "line-dasharray": [2, 2] } });
      m.addSource("parcel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "parcel-fill", type: "fill", source: "parcel", paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.25 } });
      m.addLayer({ id: "parcel-line", type: "line", source: "parcel", paint: { "line-color": "#1d4ed8", "line-width": 2 } });
    });
    m.on("click", (e: MapMouseEvent) => pick.current({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    m.getCanvas().style.cursor = "crosshair";
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const source = m.getSource("parcel") as GeoJSONSource | undefined;
      const context = m.getSource("context") as GeoJSONSource | undefined;
      if (!source || !context) return;
      if (!geometry) {
        source.setData({ type: "FeatureCollection", features: [] });
        context.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      // base-zoning polygons are parcel-granular and would just re-draw the parcel; show the other kinds
      const ctx = features.filter((f) => f.kind !== "base_zoning" && f.geometry).map((f) => ({ type: "Feature" as const, geometry: f.geometry as never, properties: { kind: f.kind, code: f.code, layer: f.layer_key } }));
      context.setData({ type: "FeatureCollection", features: ctx });
      source.setData({ type: "Feature", geometry, properties: {} });
      m.fitBounds(bounds(geometry), { padding: 60, maxZoom: 18, duration: 600 });
    };
    // sources are created in the "load" handler; wait for that, not for "idle" (raster tiles keep the map busy)
    if (m.getSource("parcel")) apply();
    else m.once("load", apply);
  }, [geometry, features]);

  return <div ref={container} className="h-full w-full" aria-label="Parcel map" data-testid="parcel-map" />;
}
