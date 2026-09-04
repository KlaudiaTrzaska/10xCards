import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// `.env` is read by Astro's dev server, not by the Playwright process, so
// E2E_EMAIL / E2E_PASSWORD would otherwise be invisible to auth.setup.ts.
// Load it here too (Node 22 built-in; no dotenv dependency needed).
// Real environment variables win, so CI secrets are never overwritten.
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321",
    trace: "on-first-retry",
  },

  projects: [
    // Runs first: logs in and saves session to playwright/.auth/user.json
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },

    // Anonymous specs must NOT depend on the login setup: the auth gate is
    // exactly what they verify, so requiring a session to run them would be
    // circular (and would block the whole suite when credentials are absent).
    {
      name: "chromium-anon",
      testMatch: /auth-gate\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // Everything else starts already logged in.
    {
      name: "chromium",
      testIgnore: /auth-gate\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Start the dev server automatically when running tests locally.
  //
  // `rm -rf node_modules/.vite` guards against a stale Vite SSR dep cache,
  // which survives an `npm install` and then makes EVERY page render
  // "An error occurred. The file does not exist at .../.vite/deps_ssr/...".
  // That failure looks exactly like a broken assertion, so clearing the cache
  // up front keeps real failures distinguishable from environment noise.
  webServer: {
    command: "rm -rf node_modules/.vite && npm run dev",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
