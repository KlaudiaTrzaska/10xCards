/**
 * Auth setup — loguje się raz i zapisuje sesję do playwright/.auth/user.json.
 * Uruchamiany przez projekt "setup" w playwright.config.ts przed właściwymi testami.
 *
 * Dane logowania: ustaw zmienne środowiskowe E2E_EMAIL i E2E_PASSWORD
 * (np. w pliku .env.test lub eksportując je przed uruchomieniem testów).
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join("playwright", ".auth", "user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing E2E_EMAIL or E2E_PASSWORD environment variables.\n" +
        "Set them before running tests, e.g.:\n" +
        "  E2E_EMAIL=you@example.com E2E_PASSWORD=secret npx playwright test",
    );
  }

  await page.goto("/auth/signin");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait until redirected away from signin — confirms successful login
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  await page.context().storageState({ path: AUTH_FILE });
});
