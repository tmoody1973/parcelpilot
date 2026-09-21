import type { Scenario } from "../lib/dto.ts";
import { Badge, Empty } from "./ui.tsx";

// ENG-04: compare view shows every scenario's inputs and status side by side.
const ROWS: { label: string; get: (s: Scenario) => string }[] = [
  { label: "Ground-floor use", get: (s) => s.inputs.use ?? "—" },
  { label: "Units", get: (s) => (s.inputs.units ?? "—").toString() },
  { label: "Stories", get: (s) => (s.inputs.stories ?? "—").toString() },
  { label: "Height (ft)", get: (s) => (s.inputs.height_ft ?? "—").toString() },
  { label: "Parking spaces", get: (s) => (s.inputs.parking_spaces ?? "—").toString() },
  { label: "Ground-floor commercial (sq ft)", get: (s) => (s.inputs.ground_floor_commercial_sqft ?? "—").toString() },
];

export function ScenarioCompare({ scenarios }: { scenarios: Scenario[] }) {
  if (scenarios.length === 0) return <Empty>No scenarios yet. Save one to start comparing.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid="scenario-compare">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 font-medium text-muted">Input</th>
            {scenarios.map((s) => (
              <th key={s.id} className="px-3 py-2 font-semibold text-ink">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-b border-line/60">
              <td className="py-2 pr-4 text-muted">{row.label}</td>
              {scenarios.map((s) => (
                <td key={s.id} className="px-3 py-2 text-ink">
                  {row.get(s)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="py-2 pr-4 text-muted">Status</td>
            {scenarios.map((s) => (
              <td key={s.id} className="px-3 py-2">
                <Badge tone={s.status === "analyzed" ? "accent" : "neutral"}>{s.status}</Badge>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
