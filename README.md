# ParcelPilot

Preliminary zoning screen for Milwaukee infill parcels. **Not an official zoning determination.**

Plan and design: `docs/planning/`. Decisions: `docs/decisions/`. Work tracked in Linear project "ParcelPilot — vertical slice".

```
pnpm install
pnpm typecheck
pnpm build
pnpm lint
```

Workspaces: `apps/web`, `apps/worker`, `packages/zoning-core`, `packages/rules-engine`, `packages/db`, `packages/contracts`, `services/worker-py` (Python, managed with uv).

## Local environment

```
cp .env.example .env
docker compose up -d --build
```

Postgres 16 + PostGIS + pgvector on `localhost:5432`, MinIO on `localhost:9100` (console `9101`, user `parcelpilot` / `parcelpilot-local`), Python worker on `localhost:8000/health`. Ports are overridable in `.env`.
