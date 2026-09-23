import { findBannedPhrases, type MemoInput } from "@parcelpilot/contracts";
import { IDENTIFIERS, numbersIn, numbersInValue, stripIds } from "../validators/text.ts";
import type { MemoBrief } from "./brief-sections.ts";

// Deterministic validators over the rendered memo (05 §7: banned_phrases, numeric_alignment,
// citation_membership). They run on the templated brief too, so the fallback path is held to the same rule.
export type MemoValidation = { passed: boolean; problems: string[] };

// Quoted ordinance text is the code's own words (a verdict word may appear there), so it is not scanned as memo prose.
// Citation markers are link labels (source 7), not claims.
const textOf = (html: string) => html.replace(/<sup><a [^>]*class="cite">\d+<\/a><\/sup>/g, " ").replace(/<blockquote class="excerpt">[\s\S]*?<\/blockquote>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
// Every number the memo may print: anything numeric inside the input, plus the fixed category count. Trigger codes
// carry counts joined by underscores ("stacked_condo:3_candidates"), printed as "3 candidates".
function allowedNumbers(input: MemoInput): Set<string> {
  const allowed = numbersInValue(input, new Set<string>(["8", String(input.coverage.checked.length)]));
  return numbersInValue(input.decision.triggers.map((t) => t.replaceAll("_", " ")), allowed);
}

// With a brief, the numbers and pages of its cited evidence are allowed too: the brief validators (05 §7) already
// checked every sentence against the excerpts it cites.
export function validateMemo(html: string, input: MemoInput, brief?: MemoBrief | null): MemoValidation {
  const problems: string[] = [];
  const text = textOf(html);

  for (const h of findBannedPhrases(text)) problems.push(`banned_phrase:${h.phrase}`);

  const allowed = allowedNumbers(input);
  if (brief) numbersInValue([brief.evidence.map((e) => [e.verbatim_excerpt, e.page, e.printed_page]), brief.output.verified_findings.length], allowed);
  for (const n of new Set(numbersIn(stripIds(text).replace(IDENTIFIERS, " ")))) if (!allowed.has(n)) problems.push(`numeric_alignment:${n}`);

  const citedPages = new Set([
    ...input.findings.flatMap((f) => f.citations.map((c) => String(c.printed_page ?? c.page))),
    ...(brief?.evidence.map((e) => String(e.printed_page ?? e.page)) ?? []),
  ]);
  for (const m of text.matchAll(/\bp\. (\d+)/g)) if (!citedPages.has(m[1]!)) problems.push(`citation_membership:p.${m[1]}`);

  return { passed: problems.length === 0, problems: [...new Set(problems)] };
}
