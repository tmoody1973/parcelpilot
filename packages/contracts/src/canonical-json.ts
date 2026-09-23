// JSON with object keys sorted at every depth, so a hash never depends on insertion order (evidence bundles, the JEV
// prepared state, and the briefing contract all hash this form). Undefined properties are dropped and undefined array
// elements become null, as JSON.stringify does.
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x) ?? "null").join(",")}]`; // like JSON.stringify: an undefined element is null
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
