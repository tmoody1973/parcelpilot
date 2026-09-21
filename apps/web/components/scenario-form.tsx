"use client";

import { useState } from "react";
import type { NewScenarioInput } from "../lib/api-client.ts";
import type { ScenarioInputs } from "../lib/dto.ts";
import { Button, Field, Input, Select } from "./ui.tsx";

// Structured scenario inputs (PRD S-02; contracts.ScenarioInputs). Every field is user-entered; nothing is inferred.
const USES = [["multifamily", "Multifamily"], ["mixed_use", "Mixed use"], ["commercial", "Commercial"], ["other", "Other"]] as const;
const GROUND_FLOOR = [["retail", "Retail / commercial"], ["residential", "Residential"], ["none", "None / lobby only"]] as const;

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function ScenarioForm({ onSubmit, busy }: { onSubmit: (input: NewScenarioInput) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("Scenario 1");
  const [use, setUse] = useState<string>("multifamily");
  const [groundFloorUse, setGroundFloorUse] = useState<ScenarioInputs["ground_floor_use"]>("retail");
  const [v, setV] = useState({ units: "", stories: "", height_ft: "", footprint_sqft: "", setback_front_ft: "", setback_side_ft: "", setback_rear_ft: "", parking_spaces: "", ground_floor_commercial_sqft: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const inputs: ScenarioInputs = { use, ground_floor_use: groundFloorUse };
    for (const k of Object.keys(v) as Array<keyof typeof v>) { const n = num(v[k]); if (n !== undefined) (inputs as Record<string, unknown>)[k] = n; }
    await onSubmit({ name: name.trim() || "Scenario", inputs });
  }

  const numField = (label: string, k: keyof typeof v, placeholder: string) => (
    <Field label={label}><Input type="number" min={0} step="any" value={v[k]} onChange={set(k)} placeholder={placeholder} /></Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-3" data-testid="scenario-form">
      <Field label="Scenario name"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary use"><Select value={use} onChange={(e) => setUse(e.target.value)}>{USES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Ground-floor use"><Select value={groundFloorUse} onChange={(e) => setGroundFloorUse(e.target.value as ScenarioInputs["ground_floor_use"])}>{GROUND_FLOOR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {numField("Units", "units", "e.g. 24")}
        {numField("Stories", "stories", "e.g. 4")}
        {numField("Height (ft)", "height_ft", "e.g. 46")}
        {numField("Footprint (sq ft)", "footprint_sqft", "e.g. 5200")}
        {numField("Front setback (ft)", "setback_front_ft", "e.g. 5")}
        {numField("Side setback (ft)", "setback_side_ft", "e.g. 0")}
        {numField("Rear setback (ft)", "setback_rear_ft", "e.g. 10")}
        {numField("Parking spaces", "parking_spaces", "e.g. 12")}
        {numField("Ground-floor commercial (sq ft)", "ground_floor_commercial_sqft", "e.g. 3000")}
      </div>
      <p className="text-xs text-muted">Leave a field blank if you do not know it yet. Blanks are shown as missing inputs, never guessed.</p>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save draft scenario"}</Button>
    </form>
  );
}
