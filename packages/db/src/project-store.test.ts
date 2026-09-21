import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createProjectStore } from "./project-store.ts";

// Integration test against the compose database (docs/planning/03_data_model.md §6).
// Proves the M1 exit criterion: one org cannot see another org's projects or scenarios.
// Requires migrations applied; runs in CI against `docker compose up db`.
const OWNER = process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot";
const APP = process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot";

const owner = postgres(OWNER, { max: 1 });
const app = postgres(APP, { max: 1 });
const store = createProjectStore(app);
let orgA = "", orgB = "", userId = "", taxkey = "";

before(async () => {
  [{ id: orgA }] = await owner`insert into organizations (name, slug) values ('Proj A', 'proj-test-a-' || gen_random_uuid()) returning id`;
  [{ id: orgB }] = await owner`insert into organizations (name, slug) values ('Proj B', 'proj-test-b-' || gen_random_uuid()) returning id`;
  [{ id: userId }] = await owner`insert into users (email) values ('proj-test-' || gen_random_uuid() || '@example.test') returning id`;
  await owner`insert into memberships (org_id, user_id, role) values (${orgA}, ${userId}, 'owner'), (${orgB}, ${userId}, 'member')`;
  taxkey = "PT" + Math.random().toString(36).slice(2, 10);
  await owner`insert into parcels (taxkey, jurisdiction_id) values (${taxkey}, 'milwaukee-wi')`;
});
after(async () => {
  await owner`delete from organizations where id in (${orgA}, ${orgB})`; // cascades to projects/scenarios/memberships
  await owner`delete from parcels where taxkey = ${taxkey}`;
  await owner`delete from users where id = ${userId}`;
  await Promise.all([owner.end(), app.end()]);
});

test("a project created under org A is visible to org A and not org B", async () => {
  const project = await store.createProject(orgA, { parcelTaxkey: taxkey, name: "Corner infill", createdBy: userId });
  assert.equal(project.org_id, orgA);

  const listA = await store.listProjects(orgA);
  assert.ok(listA.some((p) => p.id === project.id), "org A sees its own project");

  const listB = await store.listProjects(orgB);
  assert.ok(!listB.some((p) => p.id === project.id), "org B cannot see org A's project");

  assert.equal(await store.getProject(orgB, project.id), null, "org B cannot fetch org A's project by id");
});

test("scenarios stay scoped to the owning org", async () => {
  const project = await store.createProject(orgA, { parcelTaxkey: taxkey, name: "Duplex study", createdBy: userId });
  const scenario = await store.createScenario(orgA, project.id, { name: "Baseline", use: "residential", units: 2, stories: 2 });
  assert.ok(scenario, "scenario created");
  assert.equal(scenario!.units, 2);

  const listA = await store.listScenarios(orgA, project.id);
  assert.equal(listA.length, 1);

  // Org B cannot list org A's scenarios, nor attach a scenario to org A's project.
  assert.equal((await store.listScenarios(orgB, project.id)).length, 0);
  assert.equal(await store.createScenario(orgB, project.id, { name: "Sneaky" }), null);
});
