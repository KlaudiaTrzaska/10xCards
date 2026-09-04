/**
 * Risk #1 / #2 — generated cards must survive the full path
 * generation → curation → atomic save → database → server render.
 * The lesson's headline scenario: "utrata wygenerowanych fiszek po
 * odświeżeniu strony" (context/foundation/test-plan.md §2, risks #1 and #2).
 *
 * Why E2E: this crosses auth, the generate API, curation state in the browser,
 * the save-deck transaction, the database, and the server-rendered deck page.
 * No unit or API-level test proves the card is still there after a reload.
 *
 * Boundaries — real vs mocked:
 *   REAL   : auth/session, /api/generate, /api/save-deck, database, /deck render
 *   MOCKED : nothing.
 *
 * Why nothing is mocked here — and why the obvious mock does NOT work:
 * `generateCards()` calls OpenRouter with `fetch` on the SERVER
 * (src/lib/services/generation.ts:32), so `page.route` cannot intercept it.
 * Stubbing the app's own `/api/generate` response in the browser does not help
 * either: that endpoint has ALREADY written the cards to the database with the
 * model's real text (api/generate.ts:74-86), and "Accept" only flips `status`
 * without touching content (api/save-deck.ts:67). A browser-side rewrite would
 * therefore exist only in client state — exactly the data loss this test is
 * meant to detect — and the test would fail against a perfectly healthy app.
 *
 * So the unique marker is introduced through the one curation path that really
 * does persist text: EDIT. That keeps every boundary real and still gives the
 * test data it can identify and clean up. Consequence: this spec needs a
 * working OPENROUTER_API_KEY and is the slowest in the suite.
 */

import { test, expect } from "@playwright/test";

// 50+ chars — GenerateForm enforces MIN_LENGTH before it will submit.
const SOURCE_TEXT =
  "Spaced repetition is a learning technique that incorporates " +
  "increasing intervals of time between reviews of previously learned material.";

test("edited generated card survives a page reload (Risk #1/#2 — persistence)", async ({ page }) => {
  // Generation hits a real LLM, so allow well beyond the 30s default.
  test.setTimeout(120_000);

  const marker = `e2e-gen-${Date.now()}`;
  const front = `${marker} front`;
  const back = `${marker} back`;

  await page.goto("/generate");

  await page.getByLabel("Study material").fill(SOURCE_TEXT);
  await page.getByRole("button", { name: "Generate cards" }).click();

  // Wait for the curation panel — a state assertion, not a timeout.
  await expect(page.getByRole("heading", { name: /of \d+ decided/ })).toBeVisible({ timeout: 90_000 });

  // Edit the first draft card so our marker reaches the database. Scope every
  // interaction to that one list item; the panel renders several cards.
  const firstCard = page.getByRole("listitem").first();
  await firstCard.getByRole("button", { name: "Edit" }).click();

  const editors = firstCard.getByRole("textbox");
  await editors.nth(0).fill(front);
  await editors.nth(1).fill(back);
  // The edit-confirm button is labelled "Confirm" (CurationPanel.tsx:256);
  // "Save" belongs to the deck-level save button at the bottom of the panel.
  await firstCard.getByRole("button", { name: "Confirm" }).click();

  // Discard the rest so the save is small and cleanup stays bounded.
  await page.getByRole("button", { name: "Discard all remaining" }).click();
  await page.getByRole("button", { name: /Save \d+ cards? to deck/ }).click();

  // The app navigates to /deck?saved=N on success.
  await page.waitForURL(/\/deck\?saved=\d+/);
  await expect(page.getByText(/cards? saved to your deck/)).toBeVisible();

  // THE RISK ASSERTION: reload and confirm the data actually persisted.
  // If the card lived only in client state, this is where it fails.
  //
  // The deck list shows only status "accepted" (api/deck/index.ts:40) ordered
  // created_at DESC, so a just-saved card is on page 1 of the paginated list.
  await page.reload();
  await expect(page).toHaveURL(/\/deck/);
  await expect(page.getByText(front, { exact: true })).toBeVisible();
  await expect(page.getByText(back, { exact: true })).toBeVisible();

  // Cleanup — re-resolve each pass, because deleting a row re-renders the list.
  const created = page.locator("li").filter({ hasText: marker });
  for (let remaining = await created.count(); remaining > 0; remaining--) {
    const item = created.first();
    await item.getByRole("button", { name: "Delete card" }).click();
    await item.getByRole("button", { name: "Confirm" }).click();
    await expect(created).toHaveCount(remaining - 1);
  }

  await expect(created).toHaveCount(0);
});
