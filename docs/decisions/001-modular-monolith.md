# 001 — One codebase, one database, not microservices

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** Build ParcelPilot as a modular monolith: one TypeScript codebase deployed as a web app plus a background worker, one small Python service for PDF work, and one PostgreSQL database, with modules separated by package boundaries rather than network calls.

**Why this came up.** The product has six distinct "brains" (parcel resolution, rules engine, retrieval, JEV, policy, briefing LLM). The obvious modern reflex is one service per brain. Getting this wrong early means either a distributed system nobody can debug or a ball of mud nobody can test.

**Options.**
1. Microservices per brain. Cost: network calls between every step, six deployables, and the hardest property we need (one run pinned to exact source versions in one transaction) becomes a distributed-consistency problem.
2. Modular monolith with a strict service boundary (chosen). Cost: discipline. The boundary is a package import rule and a lint check, not a firewall; someone can violate it in a PR.
3. Single flat Next.js app with everything in route handlers. Cost: model calls and rules end up in UI code, and the safety chain can't be tested without a browser.

**What we chose and why.** Option 2. Pilot volume is tens of screens a day. The safety story depends on one database transaction pinning one run to one parcel snapshot, one rule-version set, one embedding version. A monolith makes that a foreign key; microservices make it a saga.

**What we gave up.** Independent scaling of the PDF worker and the web app (mitigated by keeping Python as its own process). The option to rewrite one brain in another language later without a refactor of the boundary.

**How we'll know if this was right.** In M5, one engineer can trace a run end to end from a single trace id, and the rules engine has zero I/O imports (lint passes). If we ever need a second database or a message broker to hit latency targets, this was wrong.

**What actually happened.** _(Tarik fills in later.)_
