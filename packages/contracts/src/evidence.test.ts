import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BundleEvidence, EvidenceBundle, RequiredContextSlot, BUNDLE_SCHEMAS } from "./evidence.ts";

// A well-formed bundle for the shared assertions below.
const bundle = {
  version: "evidence_bundle.v1" as const,
  feasibility_run_id: null,
  jurisdiction_id: "milwaukee-wi",
  analysis_date: "2026-09-22",
  embedding_version: { id: "v1", provider: "openai", model_name: "text-embedding-3-large", dimension: 1536 },
  evidence: [
    { source_id: "chunk_295_505_2", official_url: "https://example.gov/295.pdf", document_title: "Chapter 295 Subchapter 5", section: "295-505-2", page: 14, verbatim_excerpt: "Height, maximum (ft.). RM4: 60.", status: "active" as const },
  ],
  subquestions: [
    {
      subquestion: "maximum building height in RM4",
      category: "height" as const,
      districts: ["RM4"],
      run_id: "run-1",
      evidence: [{ source_id: "chunk_295_505_2", rank: 1, context_type: null }],
      required_context_found: { parent_section: true, definition: false },
      missing_context: ["definition" as const],
    },
  ],
  jev_flags: { active_version_confirmed: true, overlay_detected: false, required_context_complete: false, coverage_gap_list: ["height:definition"] },
};

test("the required-context slots include definition and superseding_amendment (04 §6.3)", () => {
  assert.deepEqual(RequiredContextSlot.options, [
    "parent_section", "adjacent", "cross_reference", "exception", "district_general_provision", "overlay", "definition", "superseding_amendment",
  ]);
});

test("a BundleEvidence entry carries exactly the 05 §5 evidence_bundle fields", () => {
  assert.deepEqual(Object.keys(BundleEvidence.shape).sort(), ["document_title", "official_url", "page", "section", "source_id", "status", "verbatim_excerpt"]);
});

test("a well-formed bundle parses; version is pinned to evidence_bundle.v1", () => {
  const parsed = EvidenceBundle.parse(bundle);
  assert.equal(parsed.version, "evidence_bundle.v1");
  assert.throws(() => EvidenceBundle.parse({ ...bundle, version: "evidence_bundle.v2" }));
});

test("a bundle citation status must be a known SourceStatus", () => {
  assert.throws(() => EvidenceBundle.parse({ ...bundle, evidence: [{ ...bundle.evidence[0], status: "live" }] }));
});

test("EvidenceBundle JSON Schema is emitted, indexed, and identical in both trees", () => {
  const a = join(import.meta.dirname, "..", "schema");
  const b = join(import.meta.dirname, "..", "..", "..", "services", "worker-py", "app", "schema");
  const name = Object.keys(BUNDLE_SCHEMAS)[0]!;
  const fa = readFileSync(join(a, `${name}.schema.json`), "utf8");
  const fb = readFileSync(join(b, `${name}.schema.json`), "utf8");
  assert.equal(fa, fb, `${name} schema drifted between contracts and worker-py; run pnpm contracts:emit`);
  assert.equal(JSON.parse(readFileSync(join(a, "index.json"), "utf8"))[name], `${name}.schema.json`);
});
