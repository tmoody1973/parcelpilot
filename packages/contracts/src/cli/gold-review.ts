// The gold-set review and freeze (MOO-843; 08 Q-29).
//   node packages/contracts/src/cli/gold-review.ts apply <dir> [--partial]
//     <dir>/reviews/<case>.json: the labels saved on the review page, downloaded with ArtifactData (out_dir). Writes each
//     label into its gold file. A label made on another version of the case (hash mismatch) is refused.
//   node packages/contracts/src/cli/gold-review.ts freeze [--allow-unreviewed]
//     Writes packages/contracts/gold-manifest.json: every case's version and file hash, plus one hash over the set.
//     Refuses unreviewed cases, and a changed case whose version was not bumped.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FinalStatus, JevRoute } from "../enums.ts";
import { GoldCase } from "../gold-case.ts";

const root = join(import.meta.dirname, "..", "..");
const GOLD = join(root, "gold");
export const MANIFEST = join(root, "gold-manifest.json");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const files = () => readdirSync(GOLD).filter((f) => f.endsWith(".json")).sort();

const Review = z.object({
  case_id: z.string(), case_hash: z.string(), decision: z.enum(["approve", "change", "reject"]), reason: z.string(),
  final_status: FinalStatus.optional(), route: JevRoute.optional(), saved_at: z.string(),
});

function apply(dir: string, partial: boolean) {
  const problems: string[] = [];
  let applied = 0;
  for (const f of files()) {
    const raw = readFileSync(join(GOLD, f), "utf8");
    const c = GoldCase.parse(JSON.parse(raw));
    const path = join(dir, "reviews", `${c.id}.json`);
    if (!existsSync(path)) { problems.push(`${c.id}: no label yet`); continue; }
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const r = Review.parse(doc.data ?? doc);
    if (r.case_hash !== sha(raw).slice(0, 16)) { problems.push(`${c.id}: labeled on a different version of the case; label it again`); continue; }
    if (r.decision === "change" && (!r.final_status || !r.route || !r.reason.trim())) { problems.push(`${c.id}: a changed answer needs a status, a route and a reason`); continue; }
    if (r.decision === "reject" && !r.reason.trim()) { problems.push(`${c.id}: a rejection needs a reason`); continue; }
    const { label: _label, reason: _reason, ...rest } = c.review;
    const same = r.decision === "change" && r.final_status === c.expected.final_status && r.route === c.expected.route;
    const review = {
      ...rest, status: r.decision === "reject" ? "rejected" : "approved", reviewer: "tarik", reviewed_at: r.saved_at.slice(0, 10),
      ...(r.decision === "change" && !same ? { label: { final_status: r.final_status!, route: r.route!, reason: r.reason.trim() } } : {}),
      ...(r.reason.trim() && !(r.decision === "change" && !same) ? { reason: r.reason.trim() } : {}),
    };
    writeFileSync(join(GOLD, f), JSON.stringify({ ...c, review }, null, 2) + "\n");
    applied++;
  }
  console.log(`${applied} label(s) applied`);
  if (problems.length) { console.error(problems.join("\n")); if (!partial) process.exit(1); }
}

type Manifest = { version: 1; frozen_at: string; set_sha256: string; cases: { id: string; version: number; sha256: string; status: string }[] };

function freeze(allowUnreviewed: boolean) {
  const prev: Manifest | null = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
  const problems: string[] = [];
  const cases = files().map((f) => {
    const raw = readFileSync(join(GOLD, f), "utf8");
    const c = GoldCase.parse(JSON.parse(raw));
    const was = prev?.cases.find((x) => x.id === c.id);
    if (c.review.status === "unreviewed" && !allowUnreviewed) problems.push(`${c.id}: not reviewed`);
    if (was && was.sha256 !== sha(raw) && c.version <= was.version) problems.push(`${c.id}: changed since the last freeze without a version bump (v${c.version})`);
    return { id: c.id, version: c.version, sha256: sha(raw), status: c.review.status };
  });
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const manifest: Manifest = { version: 1, frozen_at: new Date().toISOString().slice(0, 10), set_sha256: sha(cases.map((c) => `${c.id}:${c.version}:${c.sha256}`).join("\n")), cases };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`frozen: ${cases.length} cases, set ${manifest.set_sha256.slice(0, 12)}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "apply" && arg) apply(arg, process.argv.includes("--partial"));
else if (cmd === "freeze") freeze(process.argv.includes("--allow-unreviewed"));
else { console.error("usage: gold-review.ts apply <dir> [--partial] | freeze [--allow-unreviewed]"); process.exit(2); }
