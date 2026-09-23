import { findBannedPhrases, type MemoInput } from "@parcelpilot/contracts";
import { numbersIn, numbersInValue, stripIds } from "../validators/text.ts";

// Deterministic validators over the rendered memo (05 §7: banned_phrases, numeric_alignment,
// citation_membership). They run on the templated brief too, so the fallback path is held to the same rule.
export type MemoValidation = { passed: boolean; problems: string[] };

const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
// Every number the memo may print: anything numeric inside the input, plus the fixed category count.
function allowedNumbers(input: MemoInput): Set<string> {
  return numbersInValue(input, new Set<string>(["8", String(input.coverage.checked.length)]));
}

export function validateMemo(html: string, input: MemoInput): MemoValidation {
  const problems: string[] = [];
  const text = textOf(html);

  for (const h of findBannedPhrases(text)) problems.push(`banned_phrase:${h.phrase}`);

  const allowed = allowedNumbers(input);
  for (const n of new Set(numbersIn(stripIds(text)))) if (!allowed.has(n)) problems.push(`numeric_alignment:${n}`);

  const citedPages = new Set(input.findings.flatMap((f) => f.citations.map((c) => String(c.printed_page ?? c.page))));
  for (const m of text.matchAll(/\bp\. (\d+)/g)) if (!citedPages.has(m[1]!)) problems.push(`citation_membership:p.${m[1]}`);

  return { passed: problems.length === 0, problems: [...new Set(problems)] };
}
