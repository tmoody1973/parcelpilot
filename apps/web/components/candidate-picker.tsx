import type { ParcelCandidate } from "../lib/dto.ts";
import { Card, CardHeader } from "./ui.tsx";

// ENG-02: a point over stacked condos maps to more than one TAXKEY. Analysis stays blocked until the
// user picks one — the app must never silently choose. The chosen TAXKEY is stored on the scenario.
export function CandidatePicker({ candidates, onSelect }: { candidates: ParcelCandidate[]; onSelect: (taxkey: string) => void }) {
  return (
    <Card>
      <CardHeader title="More than one parcel here" subtitle="This location has stacked or overlapping TAXKEYs. Choose the one you mean." />
      <ul className="divide-y divide-line" data-testid="candidate-picker">
        {candidates.map((c) => (
          <li key={c.taxkey}>
            <button
              type="button"
              onClick={() => onSelect(c.taxkey)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-accent-soft"
            >
              <span>
                <span className="font-medium text-ink">{c.address || c.taxkey}</span>
                {c.unit ? <span className="text-muted"> · Unit {c.unit}</span> : null}
                <span className="block text-xs text-muted">
                  TAXKEY {c.taxkey}
                  {c.zoning ? ` · zoning ${c.zoning}` : ""}
                </span>
              </span>
              <span className="text-accent">Select →</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
