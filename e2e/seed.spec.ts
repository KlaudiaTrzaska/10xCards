/**
 * Seed test — wzorzec dobrego testu E2E dla 10xCards.
 *
 * Cel: pokazać agentowi konwencje, których musi przestrzegać przy generowaniu
 * testów E2E: getByRole jako domyślny selektor, czekanie na stan zamiast na czas,
 * unikalne identyfikatory w danych, cleanup, nazwa powiązana z ryzykiem.
 *
 * Ryzyko: #2 — "Changes to deck management silently break list or CRUD flows"
 *         #6 — "Unauthenticated user reaches product routes"
 * (context/foundation/test-plan.md)
 */

import { test, expect } from "@playwright/test";

test("manually created card persists in deck after page reload (Risk #2 — deck CRUD)", async ({ page }) => {
  const front = `Q: seed-test-${Date.now()}`;
  const back = `A: seed-answer-${Date.now()}`;

  await page.goto("/deck");

  // Open the create-card modal
  await page.getByRole("button", { name: "Add Card" }).click();

  // Fill the form — scoped to dialog to avoid ambiguity with other page buttons
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Front").fill(front);
  await dialog.getByLabel("Back").fill(back);
  await dialog.getByRole("button", { name: "Add Card" }).click();

  // Card should appear in the list once the modal closes and list refreshes
  await expect(page.getByText(front)).toBeVisible();

  // Reload and verify persistence — this is the actual risk assertion
  await page.reload();
  // Guard: if auth didn't survive the reload the middleware redirects to signin;
  // this assertion gives a clear failure message instead of "element not found"
  await expect(page).toHaveURL("/deck");
  await expect(page.getByText(front)).toBeVisible({ timeout: 10_000 });

  // Cleanup: scope delete to the specific card's list item to avoid ambiguity
  // when other cards are already in the deck
  const cardItem = page.locator("li").filter({ hasText: front });
  await cardItem.getByRole("button", { name: "Delete card" }).click();
  await cardItem.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText(front)).not.toBeVisible();
});

test("unauthenticated user is redirected away from protected routes (Risk #6 — auth gate)", async ({
  page,
  context,
}) => {
  // Clear all cookies to simulate a logged-out user; the page fixture already
  // has baseURL set, so relative URLs resolve correctly
  await context.clearCookies();

  await page.goto("/deck");

  // Middleware must redirect to sign-in; never serve the protected page
  await expect(page).toHaveURL(/\/auth\/signin/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
