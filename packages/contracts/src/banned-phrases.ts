// Words the product must never use as a verdict. Ordinance table labels such as "permitted use"
// may be quoted as cited data; the copy lint allows a line with a `banned-ok` marker for that case.
export const BANNED_PHRASES = ["approved", "fully compliant", "by right", "permitted", "compliant"] as const;

const PATTERN = new RegExp(`\\b(${BANNED_PHRASES.map((p) => p.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");
const NEGATED = /\b(non-|not\s+|un)compliant\b/i;

export type BannedHit = { phrase: string; line: number; column: number; text: string };

export function findBannedPhrases(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  text.split("\n").forEach((lineText, i) => {
    if (lineText.includes("banned-ok")) return;
    for (const m of lineText.matchAll(PATTERN)) {
      const phrase = m[0].toLowerCase();
      if (phrase === "compliant" && NEGATED.test(lineText)) continue; // "non-compliant" is a finding, not a verdict
      hits.push({ phrase, line: i + 1, column: (m.index ?? 0) + 1, text: lineText.trim() });
    }
  });
  return hits;
}
