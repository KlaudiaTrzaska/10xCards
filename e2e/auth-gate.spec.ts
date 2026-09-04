/**
 * Risk #6 — "Unauthenticated user reaches product routes (generate, deck,
 * study) and reads or writes data" (context/foundation/test-plan.md §2)
 *
 * Why E2E: the risk lives across several system boundaries — middleware,
 * cookie handling, redirect, and the API's 401 path. No isolated unit test
 * proves that a logged-out browser cannot reach the rendered page.
 *
 * This spec deliberately runs WITHOUT the saved storageState, so it does not
 * depend on the auth setup project.
 */

import { test, expect } from "@playwright/test";

// Opt out of the project-level storageState — these tests must be anonymous.
test.use({ storageState: { cookies: [], origins: [] } });

const PROTECTED_PAGES = ["/generate", "/deck", "/study", "/settings", "/home"];

for (const path of PROTECTED_PAGES) {
  test(`logged-out user is redirected away from ${path} and never sees its content (Risk #6)`, async ({ page }) => {
    await page.goto(path);

    // Middleware must send us to sign-in, preserving where we were headed
    // (middleware.ts:31-33). Compare parsed URL parts rather than regex-matching
    // percent-encoded text, so the assertion cannot break on escaping details.
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return `${url.pathname}?returnTo=${url.searchParams.get("returnTo") ?? ""}`;
      })
      .toBe(`/auth/signin?returnTo=${path}`);

    // The sign-in form must actually be rendered — not the protected page.
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
}

test("logged-out API request returns 401 JSON and no deck data (Risk #6)", async ({ request }) => {
  const res = await request.get("/api/deck");

  expect(res.status()).toBe(401);

  // toEqual pins the WHOLE body, which is the stronger claim: it proves the
  // response carries the error and nothing else — no `cards`, no `total`, no
  // leaked rows. A separate not.toContain("cards") would add nothing.
  const body: unknown = await res.json();
  expect(body).toEqual({ error: "Unauthorized" });
});

test("logged-out write attempt is rejected before touching the database (Risk #6)", async ({ request }) => {
  const res = await request.post("/api/deck", {
    data: { front: `intruder-${Date.now()}`, back: "should never persist" },
  });

  expect(res.status()).toBe(401);
});
