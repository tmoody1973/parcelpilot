import { ScenarioInputs, ScenarioInputsPatch } from "@parcelpilot/contracts";
import { NextResponse } from "next/server";

// Validates a scenario payload at the API boundary. Structured fields live in `draft_inputs` (the full
// validated object) and are mirrored into the explicit columns the schema exposes for querying.
export type ScenarioColumns = { use: string | null; units: number | null; heightFt: string | null; stories: number | null; parkingSpaces: number | null; groundFloorCommercialSqft: string | null; draftInputs: Record<string, unknown> };

export function parseScenarioInputs(raw: unknown, mode: "create" | "patch"): { ok: true; inputs: Record<string, unknown> } | { ok: false; response: Response } {
  const r = (mode === "create" ? ScenarioInputs : ScenarioInputsPatch).safeParse(raw ?? {});
  if (!r.success) return { ok: false, response: NextResponse.json({ error: "invalid scenario inputs", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 }) };
  return { ok: true, inputs: r.data as Record<string, unknown> };
}

export function toColumns(inputs: Record<string, unknown>): ScenarioColumns {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "number" ? String(v) : null);
  return { use: typeof inputs["use"] === "string" ? inputs["use"] : null, units: num(inputs["units"]), heightFt: str(inputs["height_ft"]), stories: num(inputs["stories"]), parkingSpaces: num(inputs["parking_spaces"]), groundFloorCommercialSqft: str(inputs["ground_floor_commercial_sqft"]), draftInputs: inputs };
}
