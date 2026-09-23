// Text helpers shared by the templated-memo validator and the brief validators (05 §7), so both are held to one
// definition of "a number in prose".

// Hex ids, dates and times are stripped before numbers are read, so a uuid or 2026-09-22 is not "a number".
export const stripIds = (t: string) =>
  t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b[0-9a-f]{16,64}…?\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ");

// Numbers as they appear in prose: "28,800", "45", "0.75", compared without thousands separators.
export const numbersIn = (t: string) => [...t.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/g)].map((m) => m[0].replaceAll(",", ""));

// Every number inside a structured value (numbers, and numbers written inside strings).
export function numbersInValue(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "number") out.add(String(v));
  else if (typeof v === "string") numbersIn(stripIds(v)).forEach((n) => out.add(n));
  else if (Array.isArray(v)) v.forEach((x) => numbersInValue(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersInValue(x, out));
  return out;
}
