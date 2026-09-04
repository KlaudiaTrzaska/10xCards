/**
 * Seed test — wzorzec dobrego testu E2E dla 10xCards.
 *
 * Cel: pokazać agentowi konwencje, których musi przestrzegać przy generowaniu
 * testów E2E:
 *   1. getByRole / getByLabel jako domyślny selektor (nigdy CSS)
 *   2. czekanie na stan (toBeVisible / waitForURL), nigdy waitForTimeout
 *   3. unikalne identyfikatory w danych testowych (Date.now())
 *   4. cleanup po sobie — test może się uruchomić wielokrotnie
 *   5. nazwa testu powiązana z ryzykiem z context/foundation/test-plan.md
 *
 * Ryzyko: #2 — "Changes to generation or deck management silently break
 *               curation, save, or list flows"
 * (context/foundation/test-plan.md §2)
 */

import { test, expect } from "@playwright/test";

test("manually created card persists in deck after page reload (Risk #2 — deck CRUD)", async ({ page }) => {
  const stamp = Date.now();
  const front = `Q: seed-front-${stamp}`;
  const back = `A: seed-back-${stamp}`;

  await page.goto("/deck");

  // The deck list is a client island — wait for it to hydrate and settle
  // rather than for an arbitrary duration.
  await expect(page.getByRole("heading", { name: "My Deck", level: 2 })).toBeVisible();

  // Open the create-card modal. The modal's submit button is ALSO named
  // "Add Card", so `exact` alone cannot disambiguate them — the trigger is
  // therefore scoped to the deck section, and every later interaction goes
  // through the `dialog` locator so the two never compete.
  const deckSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "My Deck" }) });
  await deckSection.getByRole("button", { name: "Add Card" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add Flashcard" })).toBeVisible();

  // Fields are wired via htmlFor/id, so getByLabel resolves them.
  await dialog.getByLabel("Front").fill(front);
  await dialog.getByLabel("Back").fill(back);
  await dialog.getByRole("button", { name: "Add Card" }).click();

  // Dialog closes and the list refetches — assert on the business outcome.
  // A new card is created with status "accepted" (api/deck/index.ts:90), which
  // is exactly what the deck list queries, so it shows up straight away.
  await expect(dialog).toBeHidden();
  await expect(page.getByText(front, { exact: true })).toBeVisible();

  // The actual risk assertion: does the card survive a full round-trip
  // through auth → API → database → server render?
  await page.reload();
  // Guard: if the session did not survive, middleware redirects to signin.
  // Asserting the URL first yields a clear failure instead of "not found".
  await expect(page).toHaveURL(/\/deck/);
  // `front` is truncated and `back` line-clamped in the markup
  // (DeckManager.tsx:173,177), but that is CSS-only — the text is in the DOM.
  await expect(page.getByText(front, { exact: true })).toBeVisible();
  await expect(page.getByText(back, { exact: true })).toBeVisible();

  // Cleanup — scope to this card's list item so parallel runs and pre-existing
  // cards cannot make the delete ambiguous.
  const cardItem = page.locator("li").filter({ hasText: front });
  await cardItem.getByRole("button", { name: "Delete card" }).click();
  await cardItem.getByRole("button", { name: "Confirm" }).click();

  // Assert the row is gone, not just the text — this is the locator that has
  // to reach zero for the next run to start from a clean deck.
  await expect(cardItem).toHaveCount(0);
});
