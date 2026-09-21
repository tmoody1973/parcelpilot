"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MlMap, NavigationControl, type GeoJSONSource, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import type { GeoJsonPolygon } from "../lib/dto.ts";

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

export function ParcelMap({ geometry, onPick }: { geometry: GeoJsonPolygon | null; onPick: (point: { lon: number; lat: number }) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MlMap({ container: container.current, style: BASEMAP, center: MILWAUKEE, zoom: 11 });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
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
      if (!source) return;
      if (!geometry) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      source.setData({ type: "Feature", geometry, properties: {} });
      m.fitBounds(bounds(geometry), { padding: 60, maxZoom: 18, duration: 600 });
    };
    if (m.isStyleLoaded()) apply();
    else m.once("idle", apply);
  }, [geometry]);

  return <div ref={container} className="h-full w-full" aria-label="Parcel map" data-testid="parcel-map" />;
}
