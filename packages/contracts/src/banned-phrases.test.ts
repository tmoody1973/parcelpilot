import { test } from "node:test";
import assert from "node:assert/strict";
import { findBannedPhrases } from "./banned-phrases.ts";

test("flags verdict words, case-insensitively", () => {
  const hits = findBannedPhrases("This project is Approved and permitted by right.");
  assert.deepEqual(hits.map((h) => h.phrase), ["approved", "permitted", "by right"]);
});
test("does not flag non-compliant (a finding) or banned-ok lines", () => {
  assert.equal(findBannedPhrases("Height is non-compliant with 295-605-2.").length, 0);
  assert.equal(findBannedPhrases('Table label: "permitted use" // banned-ok quoted from source').length, 0);
});
test("clean copy passes", () => {
  assert.equal(findBannedPhrases("Preliminary zoning screen — not an official zoning determination.").length, 0);
});
