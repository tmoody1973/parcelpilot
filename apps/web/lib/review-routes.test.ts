import { test } from "node:test";
import assert from "node:assert/strict";

// The reviewer gate on every /api/review route, exercised through the real handlers in dev auth mode against the compose DB.
// A member gets the 403 envelope on each route; a reviewer (x-dev-role) gets past the gate.
process.env["AUTH_MODE"] = "dev";
delete process.env["CLERK_SECRET_KEY"];
process.env["DATABASE_SERVICE_URL"] ??= "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot";
process.env["DATABASE_APP_URL"] ??= "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot";

const tasks = await import("../app/api/review/tasks/route.ts");
const taskAction = await import("../app/api/review/tasks/[taskId]/[action]/route.ts");
const sourceAction = await import("../app/api/review/sources/[sourceId]/[action]/route.ts");
const { closeDb } = await import("./db.ts");
test.after(() => closeDb());

const ORG = "review-routes-test-org";
const ZERO = "00000000-0000-0000-0000-000000000000";
const headers = (role: string) => ({ "x-dev-user": `review-routes-${role}`, "x-dev-org": ORG, "x-dev-role": role, "content-type": "application/json" });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

type Call = { name: string; run: (role: string) => Promise<Response> };
const routes: Call[] = [
  { name: "GET /api/review/tasks", run: (role) => tasks.GET(new Request("http://t/api/review/tasks", { headers: headers(role) })) },
  ...["claim", "approve", "reject", "edit"].map((action) => ({
    name: `POST /api/review/tasks/:id/${action}`,
    run: (role: string) => taskAction.POST(new Request(`http://t/api/review/tasks/${ZERO}/${action}`, { method: "POST", headers: headers(role), body: JSON.stringify({ reason: "r", patch: {} }) }), params({ taskId: ZERO, action })),
  })),
  ...["activate", "supersede", "withdraw"].map((action) => ({
    name: `POST /api/review/sources/:id/${action}`,
    run: (role: string) => sourceAction.POST(new Request(`http://t/api/review/sources/${ZERO}/${action}`, { method: "POST", headers: headers(role), body: JSON.stringify({ successor_id: ZERO }) }), params({ sourceId: ZERO, action })),
  })),
];

test("a member gets the 403 envelope on every review route", async () => {
  for (const r of routes) {
    const res = await r.run("member");
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(res.status, 403, r.name);
    assert.deepEqual(body, { ok: false, error: { code: "forbidden", message: "reviewer role required" } }, r.name);
  }
});

test("a reviewer passes the gate: the queue lists, and an unknown task or source is a 404 envelope, not a 403", async () => {
  const list = await routes[0]!.run("reviewer");
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as { ok: boolean }).ok, true);
  for (const r of routes.slice(1)) {
    const res = await r.run("reviewer");
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(res.status, 404, `${r.name}: ${JSON.stringify(body)}`);
    assert.equal(body.error?.code, "not_found", r.name);
  }
});

test("no identity at all is a 401 envelope, before any role check", async () => {
  const res = await tasks.GET(new Request("http://t/api/review/tasks"));
  assert.equal(res.status, 401);
});
