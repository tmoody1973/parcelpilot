import type { SiteProfile } from "../lib/dto.ts";
import { Badge, Card, CardHeader } from "./ui.tsx";

// Read-only site profile (ENG-03): curated MPROP fields, base zoning, intersecting layers, source freshness.
// Copy never states a zoning verdict — it reports what the record says and flags what is uncertain.

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

function fmtArea(sqft: number | null): string {
  return sqft === null ? "—" : `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

export function SiteProfilePanel({ profile }: { profile: SiteProfile }) {
  const gis = profile.gis;
  const overlays = [...gis.overlays, ...gis.special_districts, ...gis.planned_development, ...gis.floodplain];
  return (
    <Card>
      <CardHeader
        title="Site profile"
        subtitle={profile.address || profile.taxkey}
        action={<Badge tone="neutral">TAXKEY {profile.taxkey}</Badge>}
      />
      <div className="px-4 py-2">
        <Row label="MPROP zoning field" value={profile.zoning ?? "—"} />
        <Row
          label="Base zoning district"
          value={gis.base_zoning.length ? gis.base_zoning.join(", ") : profile.zoning ?? "—"}
        />
        <Row label="Lot area" value={fmtArea(profile.lot_area_sqft)} />
        <Row label="Corner lot" value={profile.corner_lot ?? "—"} />
        <Row label="Units on record" value={profile.nr_units ?? "—"} />

        {gis.gis_ambiguity ? (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            Two base zoning districts each cover a meaningful share of this parcel
            {` (${gis.base_zoning.join(", ")})`}. Treat the base district as uncertain and verify with the City.
          </p>
        ) : null}

        {profile.lot_area_suspect ? (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            The recorded lot area looks outside the plausible range. Confirm the dimensions before relying on them.
          </p>
        ) : null}

        <div className="mt-3 border-t border-line pt-2">
          <span className="text-xs font-medium text-muted">Overlays and districts</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {overlays.length ? (
              overlays.map((code) => (
                <Badge key={code} tone="accent">
                  {code}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-ink">None intersect this parcel.</span>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-2 text-xs text-muted">
          Source snapshot retrieved {fmtDate(profile.retrieved_at)}
          {profile.gis_datetime ? ` · City GIS dated ${fmtDate(profile.gis_datetime)}` : ""}
          {profile.snapshot_reused ? " · reused a recent snapshot" : " · newly captured"}
        </div>
      </div>
    </Card>
  );
}
