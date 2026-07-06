import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const e2eResultsDir = join(process.cwd(), "e2e-results");
const runtimeDatabasePath = join(e2eResultsDir, "runtime-e2e.sqlite");

mkdirSync(e2eResultsDir, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: "e2e-results/playwright-output",
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e-results/playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on",
    video: "on",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: `CLEAR402_RUNTIME_DATABASE_PATH=${runtimeDatabasePath} pnpm --filter @clear402/runtime dev`,
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000
    },
    {
      command: "pnpm --filter @clear402/provider-x402 dev",
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000
    },
    {
      command:
        "RUNTIME_HEALTH_URL=http://127.0.0.1:4000/health PROVIDER_X402_HEALTH_URL=http://127.0.0.1:4010/health pnpm --filter dashboard dev --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 1100 }
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome"
      }
    }
  ]
});
