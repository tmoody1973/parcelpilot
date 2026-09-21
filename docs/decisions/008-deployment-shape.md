# 008 — Deploy on Vercel + Fly.io + Neon + Cloudflare R2, not a single self-managed box

**Date:** 2026-09-21 · **Status:** decided · **Decided by:** Tarik

**Decision.** The web app runs on Vercel, the Node worker and the Python PDF worker on Fly.io, the database on Neon (managed Postgres with PostGIS and pgvector), and files in Cloudflare R2. Staging and production are separate projects with separate keys. Local development stays on docker compose.

**Why this came up.** Tarik already pays for a Hetzner VPS. Running everything there is cheapest on paper, but it makes one person responsible for uptime, backups, and upgrades for a product that lenders and partners may read memos from.

**Options.**
1. Everything on the Hetzner box with docker compose. Cost: you own backups, restarts, disk, and security patches; a bad night is your night.
2. Vercel + Fly + Neon + R2 (chosen). Cost: roughly $40 to $60 a month at pilot volume, four dashboards, and two login users to create by hand on Neon.
3. A single platform (Render, Railway) for everything. Cost: fewer dashboards but weaker Postgres extensions story and less control over the Python worker's memory.

**What we chose and why.** Option 2. Managed Postgres with both extensions removes the scariest ops task (database backups and restores) and Vercel is the natural home for Next.js. Ops appetite decided it, not price.

**What we gave up.** The cheapest possible bill, and single-box simplicity. Neon cold starts on the smallest plan can add a second to the first request after idle.

**How we'll know if this was right.** During the pilot (M6) no engineer spends time on infrastructure incidents, and the monthly bill stays under $100.

**What actually happened.** _(Tarik fills in later.)_
