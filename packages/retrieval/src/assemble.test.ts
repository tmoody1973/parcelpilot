import { test } from "node:test";
import assert from "node:assert/strict";
import { EvidenceBundle } from "@parcelpilot/contracts";
import { assembleBundle, type BundleDocument } from "./assemble.ts";
import type { ContextSlot, Hit, RetrieveResult } from "./retrieve.ts";

// Pure assembler test: no database. It feeds fabricated retrieval results and checks the packaged bundle.
const version = { id: "v1", provider: "local-hash", model_name: "assemble-test", dimension: 1536, is_active: true };

function hit(chunk_id: string, over: Partial<Hit> = {}): Hit {
  return {
    chunk_id, rank: 1, section: "295-505-2", heading: null, page_start: 14, page_end: null, source_type: "table_row",
    document_sha: "sha-doc", text: "Height, maximum (ft.). RM4: 60.", district_codes: ["RM4"], anchors: null,
    lexical_rank: 1, semantic_rank: 1, lexical_score: 0.5, semantic_score: 0.5, rerank_score: null, relevance: 0.03,
    reason: "keyword rank 1", context_type: null, footnotes: [], ...over,
  };
}

function result(over: Partial<RetrieveResult> = {}): RetrieveResult {
  return { run_id: "run-1", version, hits: [hit("c1")], context: [], context_found: {}, filters: {}, ...over };
}

const docs: Record<string, BundleDocument> = { "sha-doc": { title: "Chapter 295 Subchapter 5", official_url: "https://example.gov/295.pdf", status: "active" } };
const base = { jurisdictionId: "milwaukee-wi", analysisDate: "2026-09-22", documents: docs };

test("the assembled bundle validates against the EvidenceBundle contract", () => {
  const bundle = assembleBundle({ ...base, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], result: result() }] });
  assert.doesNotThrow(() => EvidenceBundle.parse(bundle));
  assert.equal(bundle.version, "evidence_bundle.v1");
  assert.equal(bundle.evidence[0]!.document_title, "Chapter 295 Subchapter 5");
  assert.equal(bundle.evidence[0]!.verbatim_excerpt, "Height, maximum (ft.). RM4: 60.");
});

test("a chunk served in two subquestions appears once in the flat evidence, but in both subquestion lists", () => {
  const bundle = assembleBundle({
    ...base,
    sources: [
      { subquestion: "max height", category: "height", districts: ["RM4"], result: result() },
      { subquestion: "min height", category: "height", districts: ["RM4"], result: result({ run_id: "run-2" }) },
    ],
  });
  assert.equal(bundle.evidence.length, 1, "deduplicated by source_id");
  assert.deepEqual(bundle.subquestions.map((s) => s.run_id), ["run-1", "run-2"]);
  assert.deepEqual(bundle.subquestions.map((s) => s.evidence[0]!.source_id), ["c1", "c1"]);
});

test("hits rank ahead of context, and a context chunk keeps its slot label", () => {
  const r = result({ hits: [hit("c1", { rank: 1 })], context: [hit("c2", { rank: 11, context_type: "definition", section: "295-201" })], context_found: { definition: true } });
  const bundle = assembleBundle({ ...base, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], result: r }] });
  const entries = bundle.subquestions[0]!.evidence;
  assert.deepEqual(entries.map((e) => [e.source_id, e.context_type]), [["c1", null], ["c2", "definition"]]);
});

test("a slot the retriever looked for but did not find becomes a coverage gap", () => {
  const missing: Partial<Record<ContextSlot, boolean>> = { parent_section: true, definition: false, superseding_amendment: false };
  const bundle = assembleBundle({ ...base, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], result: result({ context_found: missing }) }] });
  assert.deepEqual(bundle.subquestions[0]!.missing_context.sort(), ["definition", "superseding_amendment"]);
  assert.deepEqual(bundle.jev_flags.coverage_gap_list.sort(), ["height:definition", "height:superseding_amendment"]);
  assert.equal(bundle.jev_flags.required_context_complete, false);
});

test("JEV flags: active version and overlay detection", () => {
  const complete = assembleBundle({ ...base, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], overlays: ["floodplain"], result: result() }] });
  assert.equal(complete.jev_flags.active_version_confirmed, true);
  assert.equal(complete.jev_flags.overlay_detected, true);
  assert.equal(complete.jev_flags.required_context_complete, true);

  const stale = assembleBundle({ ...base, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], result: result({ version: { ...version, is_active: false } }) }] });
  assert.equal(stale.jev_flags.active_version_confirmed, false);
});

test("a district question (null category) scopes its coverage gap by district", () => {
  const bundle = assembleBundle({ ...base, sources: [{ subquestion: "where does RM4 apply", category: null, districts: ["RM4"], result: result({ context_found: { district_general_provision: false } }) }] });
  assert.equal(bundle.subquestions[0]!.category, null);
  assert.deepEqual(bundle.jev_flags.coverage_gap_list, ["RM4:district_general_provision"]);
});

test("a served chunk with no document metadata is an error, not a blank citation", () => {
  assert.throws(
    () => assembleBundle({ ...base, documents: {}, sources: [{ subquestion: "max height", category: "height", districts: ["RM4"], result: result() }] }),
    /no document metadata/,
  );
});

test("assembling with no retrieval results is rejected", () => {
  assert.throws(() => assembleBundle({ ...base, sources: [] }), /at least one retrieval result/);
});
