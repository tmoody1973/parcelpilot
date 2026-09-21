Next.js App Router workspace: the map + decision-panel UI and API route handlers. Calls `@parcelpilot/zoning-core`; never talks to models or ArcGIS directly.

## M1 workspace

`/` is the parcel workspace: address / TAXKEY / map-click search, the stacked-condo TAXKEY picker, the site
profile (MPROP fields, base zoning, intersecting overlays, source freshness), and a scenario form that saves
drafts. `/projects` lists saved projects; `/projects/[id]` reopens one and compares its scenarios.

### Layering

The browser calls route handlers under `app/api/*`; the handlers own zod validation, org context, and the
`{ ok, data, error }` envelope. The safety chain lives in `lib/parcel-service.ts`, which calls
`@parcelpilot/zoning-core` (`resolveParcel`, ArcGIS client) and `@parcelpilot/db` (`computeIntersections`,
`createParcelStore`, `createProjectStore`). Parcels and GIS use the service connection; projects and scenarios
use the app connection under Row Level Security (`app.org_id`).

### Auth (M1 stub)

There is no auth provider yet (Clerk arrives with MOO-807). `lib/org.ts` resolves every request to the seeded
bootstrap org from migration `0011`. `x-org-id` / `x-user-id` headers override it for tests. Row Level Security
still enforces isolation, so this stub does not weaken tenancy.

### Environment

- `DATABASE_SERVICE_URL` — jurisdiction-shared tables (parcels, GIS); bypasses RLS.
- `DATABASE_APP_URL` — tenant-scoped tables (projects, scenarios); RLS applies.

Both default to the local `docker compose` database. Run `pnpm db:migrate` first.

### Commands

- `pnpm --filter @parcelpilot/web dev` — dev server.
- `pnpm --filter @parcelpilot/web build` — production build (needs the workspace packages built first; `pnpm build` does this).
- `pnpm --filter @parcelpilot/web test:e2e` — Playwright specs. They stub `/api` with `page.route`, so they need
  no database or City services, but they do need a browser (`pnpm exec playwright install chromium`) and a
  production build. Not part of the node CI job.
