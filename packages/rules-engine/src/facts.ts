import type { ParcelFacts, Predicate, ScenarioInputs } from "@parcelpilot/contracts";

export type FactContext = { parcel: ParcelFacts; scenario: ScenarioInputs };
export type FactRead = { found: true; value: unknown } | { found: false };

// Reads "scenario.height_ft", "parcel.lot_area_sqft" or "parcel.attributes.corner_lot".
// Missing or undefined = not found; null is a real value that means "known to be unknown".
export function readFact(path: string, ctx: FactContext): FactRead {
  const [root, ...rest] = path.split(".");
  let cur: unknown = root === "scenario" ? ctx.scenario : root === "parcel" ? ctx.parcel : undefined;
  for (const key of rest) {
    if (cur === null || typeof cur !== "object") return { found: false };
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur === undefined ? { found: false } : { found: true, value: cur };
}

// True/false when the predicate resolves; null when the fact is absent or types do not compare.
export function evaluatePredicate(p: Predicate, ctx: FactContext): boolean | null {
  const read = readFact(p.fact, ctx);
  if (!read.found || read.value === null) return null;
  const v = read.value;
  switch (p.op) {
    case "==": return v === p.value;
    case "!=": return v !== p.value;
    case "in": return Array.isArray(p.value) && (typeof v === "string" || typeof v === "number") ? p.value.includes(v) : null;
    default: {
      if (typeof v !== "number" || typeof p.value !== "number") return null;
      return p.op === ">" ? v > p.value : p.op === ">=" ? v >= p.value : p.op === "<" ? v < p.value : v <= p.value;
    }
  }
}
