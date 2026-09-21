# 005 — The briefing LLM writes the explanation only after the status is locked, and validators can veto it

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** A reasoning-capable Claude model writes the developer-facing brief from a frozen contract (the locked status, findings, triggers, allowed actions, and a small set of verbatim cited excerpts). Its output is JSON with a citation on every factual sentence. Deterministic validators check status, citations, numbers, actions, and banned phrases; any hard failure renders a templated brief instead.

**Why this came up.** Users want a readable explanation, not a table of statuses. The tempting shortcut is "ask the model to explain the risk", which lets the model quietly change the answer or invent a rule.

**Options.**
1. Free-form explanation prompt. Cost: the model can relax the decision, cite nothing, or sound like legal advice.
2. Templated text only. Cost: robotic, and it cannot connect findings into a narrative a lender would read.
3. Frozen contract + schema output + validators + templated fallback (chosen). Cost: a validator suite to build and maintain, and more fallbacks early when validators are strict.

**What we chose and why.** Option 3. It keeps the model useful for language while keeping the decision in code. The fallback path means a validator failure degrades to "less pretty", never to "wrong".

**What we gave up.** Some fluency (sentences must cite; numbers must match calculations character for character) and some cost per screen.

**How we'll know if this was right.** M5: unsupported-claim rate on the gold set under 2 %, status-mismatch rate 0, and pilot users say the explanation told them what to do next (PRD §9.5).

**What actually happened.** _(Tarik fills in later.)_
