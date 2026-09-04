# E2E testing rules (10xCards)

Read before generating or editing any test in `e2e/`.
Canonical example: `e2e/seed.spec.ts`.

## Locator hierarchy

Use, in order of preference:

1. `getByRole('button', { name: 'Add Card' })` — default choice
2. `getByLabel('Front')` — form fields (all are wired with `htmlFor`/`id`)
3. `getByText(uniqueMarker)` — asserting on test-generated data
4. `locator('li').filter({ hasText: marker })` — scoping to one list row

Never use CSS/XPath selectors (`.card-container > div:nth-child(3)`) for
anything the user can see. Tailwind classes in this project change freely;
role and accessible name do not.

If an element cannot be reached by role, that is usually an accessibility
bug — fix the component (add `aria-label`) rather than reaching for CSS.
Icon-only buttons in `DeckManager.tsx` carry `aria-label` for this reason.

## Waiting

- Assert on state: `await expect(locator).toBeVisible()`, `toBeHidden()`
- Navigation: `await page.waitForURL(/\/deck/)`
- Never `page.waitForTimeout(n)`. It passes locally and fails in CI.
- Raise the per-assertion `timeout` for genuinely slow steps (LLM generation)
  instead of sleeping.

## Test independence

Every test must set up and clean up everything it needs. `fullyParallel: true`
is on and tests run in arbitrary order, so a test may never assume another
test created data.

## Data isolation

- Stamp every record: `` const marker = `e2e-gen-${Date.now()}` ``
- Delete what you create before the test ends.
- Both, not either: unique ids prevent collisions, cleanup prevents growth.
- Supabase RLS applies — cleanup must run as the same user that created the
  data (the `storageState` session), or it will silently see empty tables.

## Assertions must be tied to a risk

Name the test after the risk it protects, citing
`context/foundation/test-plan.md`:

```
test("generated cards saved to the deck survive a page reload (Risk #1/#2)", ...)
```

Control question for every assertion: **would this fail if the risk actually
materialized?** Asserting the page title contains "My Deck" after a reload
does not prove a card persisted. Assert on the card's own content.

## Real vs mocked boundaries

Keep internal boundaries real — that is where integration risk lives:

| Boundary                  | Real or mocked |
| ------------------------- | -------------- |
| auth / session / cookies  | real           |
| middleware + routing      | real           |
| own API routes            | real           |
| Supabase database         | real           |
| OpenRouter (LLM)          | real           |

The obvious approach — stub the app's own `/api/generate` response in the
browser with `page.route()` — does NOT work for a persistence test.
`/api/generate` writes the model's real text to the database as soon as it
returns (`api/generate.ts:74-86`); curation's "Accept" only flips `status`,
never content (`api/save-deck.ts:67`). A browser-side rewrite exists only in
client state, so a reload always shows the model's original text — the test
would fail against a perfectly healthy app.

To introduce a marker that actually reaches the database, edit the draft
card in curation before saving — that path writes `front`/`back` for real
(`api/save-deck.ts:82`). This means `generation-persistence.spec.ts` needs a
working `OPENROUTER_API_KEY` and is the slowest spec in the suite.
`generateCards()` calling OpenRouter with `fetch` **on the server**
(`src/lib/services/generation.ts:32`) is exactly why `page.route()` can't
shortcut this — there is no server-side interception in Playwright.

## Authentication

There are two browser projects (see `playwright.config.ts`):

| Project          | Session       | Matches              |
| ---------------- | ------------- | -------------------- |
| `chromium`       | logged in     | everything else      |
| `chromium-anon`  | no session    | `auth-gate.spec.ts`  |

`chromium` inherits `storageState: playwright/.auth/user.json` from the
`setup` project and needs `E2E_EMAIL` / `E2E_PASSWORD`.

`chromium-anon` deliberately has **no `dependencies`**. Anonymous specs must
not depend on the login setup: the auth gate is what they verify, so
requiring a session would be circular — and it would block the whole suite
whenever credentials are missing.

Do not log in through the UI inside a feature test. An anonymous test also
states its intent locally, which keeps it correct if the file is ever moved
between projects:

```typescript
test.use({ storageState: { cookies: [], origins: [] } });
```

Run one project at a time with `npx playwright test --project=chromium-anon`.

## Troubleshooting

After reinstalling `node_modules`, a stale Vite SSR cache can make every page
render "An error occurred." (`The file does not exist at .../.vite/deps_ssr/`).
Fix: `rm -rf node_modules/.vite`.

## Anti-patterns to reject in review

1. **Naive assertion** — passes even when the risk materializes
2. **Fragile selector** — CSS/nth-child instead of role
3. **Shared state between tests** — test B depends on test A
4. **`waitForTimeout`** instead of waiting for state
5. **No cleanup** — second run hits duplicate/accumulated data

## Other frameworks

Rules transfer; syntax changes. Cypress → `cy.findByRole` + `cy.intercept`;
WebdriverIO → `$(role=...)` + `browser.waitUntil`; Selenium → explicit waits
with `WebDriverWait`.
