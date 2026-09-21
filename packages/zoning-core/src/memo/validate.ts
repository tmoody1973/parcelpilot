import { findBannedPhrases, type MemoInput } from "@parcelpilot/contracts";

// Deterministic validators over the rendered memo (05 §7: banned_phrases, numeric_alignment,
// citation_membership). They run on the templated brief too, so the fallback path is held to the same rule.
export type MemoValidation = { passed: boolean; problems: string[] };

const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
// Numbers as they appear in prose: "28,800", "45", "0.75". Hex ids, dates, and times are stripped first.
const stripIds = (t: string) => t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ").replace(/\b[0-9a-f]{16,64}…?\b/gi, " ").replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, " ").replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ");
const numbersIn = (t: string) => [...t.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/g)].map((m) => m[0].replaceAll(",", ""));

// Every number the memo may print: anything numeric inside the input, plus the fixed category count.
function allowedNumbers(input: MemoInput): Set<string> {
  const out = new Set<string>(["8", String(input.coverage.checked.length)]);
  const walk = (v: unknown) => {
    if (typeof v === "number") out.add(String(v));
    else if (typeof v === "string") numbersIn(stripIds(v)).forEach((n) => out.add(n));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return out;
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
