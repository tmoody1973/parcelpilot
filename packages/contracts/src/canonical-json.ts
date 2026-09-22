// JSON with object keys sorted at every depth, so a hash never depends on insertion order (evidence bundles, the JEV
// prepared state, and the briefing contract all hash this form). Undefined properties are dropped, as JSON.stringify does.
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
