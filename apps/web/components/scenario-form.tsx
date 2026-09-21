"use client";

import { useState } from "react";
import type { NewScenarioInput } from "../lib/api-client.ts";
import { Button, Field, Input, Select } from "./ui.tsx";

const USES = ["residential", "commercial", "mixed use", "industrial", "other"] as const;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Scenario draft fields per 06_delivery_plan.md M1: unit count, stories, height, parking, ground-floor use.
export function ScenarioForm({ onSubmit, busy }: { onSubmit: (input: NewScenarioInput) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("Scenario 1");
  const [use, setUse] = useState<string>("residential");
  const [units, setUnits] = useState("");
  const [stories, setStories] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [parking, setParking] = useState("");
  const [groundFloor, setGroundFloor] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({
      name: name.trim() || "Scenario",
      use,
      units: numberOrNull(units),
      stories: numberOrNull(stories),
      height_ft: numberOrNull(heightFt),
      parking_spaces: numberOrNull(parking),
      ground_floor_commercial_sqft: numberOrNull(groundFloor),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-3" data-testid="scenario-form">
      <Field label="Scenario name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ground-floor use">
          <Select value={use} onChange={(e) => setUse(e.target.value)}>
            {USES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Units">
          <Input type="number" min={0} value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. 8" />
        </Field>
        <Field label="Stories">
          <Input type="number" min={0} value={stories} onChange={(e) => setStories(e.target.value)} placeholder="e.g. 3" />
        </Field>
        <Field label="Height (ft)">
          <Input type="number" min={0} value={heightFt} onChange={(e) => setHeightFt(e.target.value)} placeholder="e.g. 35" />
        </Field>
        <Field label="Parking spaces">
          <Input type="number" min={0} value={parking} onChange={(e) => setParking(e.target.value)} placeholder="e.g. 4" />
        </Field>
        <Field label="Ground-floor commercial (sq ft)">
          <Input type="number" min={0} value={groundFloor} onChange={(e) => setGroundFloor(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save scenario as draft"}
      </Button>
    </form>
  );
}
