// The demo gold case, live: resolve the real parcel, save the G01 concept, run it, fetch the memo, and
// assert the status and the cited pages. Needs a dev server with DATABASE_* and AUTH_MODE=dev
// (`pnpm --filter @parcelpilot/web dev --port 3100`) and the City's ArcGIS reachable — so it runs locally,
// not in CI. Usage: pnpm gold:live [http://127.0.0.1:3100]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const H = { "content-type": "application/json", "x-dev-user": "gold-live", "x-dev-org": "gold-live-org" };
const g01 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "contracts", "gold", "G01.json"), "utf8"));
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  assert.ok(json.ok, `${method} ${path} → ${JSON.stringify(json)}`);
  return json.data;
};

const resolved = await call("POST", "/api/parcels/resolve", { taxkey: g01.parcel.taxkey });
assert.equal(resolved.kind, "resolved");
assert.equal(resolved.profile.gis.base_zoning[0], g01.district, "district");
const project = await call("POST", "/api/projects", { name: `gold live ${new Date().toISOString()}`, parcel_taxkey: g01.parcel.taxkey });
const scenario = await call("POST", `/api/projects/${project.id}/scenarios`, { name: g01.title, inputs: g01.scenario });
const run = await call("POST", `/api/scenarios/${scenario.id}/run`, {});

assert.equal(run.final_status, g01.expected.final_status, "final_status");
assert.equal(run.route, g01.expected.route, "route");
assert.deepEqual(run.reasons, g01.expected.reasons, "reasons");
for (const [cat, exp] of Object.entries(g01.expected.findings)) {
  const got = run.findings.find((f) => f.category === cat);
  assert.equal(got?.status, exp.status, `${cat} status`);
  if (exp.proposed) assert.equal(got.proposed.value, exp.proposed.value, `${cat} proposed`);
  if (exp.allowed) assert.equal(got.allowed.value, exp.allowed.value, `${cat} allowed`);
}
const memoRes = await fetch(`${BASE}/runs/${run.id}/memo`, { headers: H });
const memo = await memoRes.text();
assert.equal(memoRes.status, 200);
assert.equal(memoRes.headers.get("x-memo-validation"), "passed", "memo validators");
for (const c of g01.citations) if (c.printed_page) assert.ok(memo.includes(`p. ${c.printed_page}`), `memo cites p. ${c.printed_page}`);
assert.ok(memo.includes("not an official zoning determination"));

console.log(`gold live OK: ${g01.id} on ${resolved.profile.address} (${g01.district}) → ${run.final_status} / ${run.route}; ${run.findings.filter((f) => f.status === "fail").length} fails; memo validation ${memoRes.headers.get("x-memo-validation")}, cites ${g01.citations.filter((c) => c.printed_page).map((c) => "p. " + c.printed_page).join(", ")}; run ${run.id}`);
