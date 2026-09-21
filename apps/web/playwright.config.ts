import { defineConfig, devices } from "@playwright/test";

// E2E for the M1 workspace. Specs stub the /api layer with page.route, so they exercise the UI flow
// (ENG-02 stacked-condo picker; ENG-04 scenario save + compare) without a live database or City services.
// Not wired into the node CI job (which has no browser); run with `pnpm --filter @parcelpilot/web test:e2e`.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
