# Bootstrap + Generation Resilience — Implementation Plan

## Overview

Bootstrap Vitest from zero, fix three active code gaps in the LLM generation pipeline, and prove protection with a full unit + integration test suite. This is Rollout Phase 1 of `context/foundation/test-plan.md`. It covers Risk #1 (LLM malformed output) and Risk #7 (oversized paste).

## Current State Analysis

No test infrastructure exists — no `vitest.config.*`, no test runner script in `package.json`, no test files. The CI workflow runs lint → build only; there is no test step.

Three active code gaps are confirmed by research:

1. **502 provider leak** (`generate.ts:47`): `GenerationError.message` is embedded verbatim in the 502 response body. Raw OpenRouter error bodies (including API keys, full JSON error objects) reach the client. Flagged in `lessons.md`.
2. **Whitespace card fields** (`generation.ts:19-20`): `CardSchema` uses `z.string().min(1)` without `.trim()`. A single space is length 1 — whitespace-only `front`/`back` passes Zod and gets persisted to the database. Flagged in `lessons.md`.
3. **Silent card count shortfall** (`generation.ts:23-24`, `82`): `ResponseSchema` requires `cards.min(1)`, not `min(count)`. If the model returns 3 cards when 10 were requested, validation passes and 3 cards are silently stored.

Five error paths are **already protected** (throw `GenerationError`, return non-200, client shows error banner): network failure, non-JSON envelope, missing `choices[0].message.content`, non-JSON model content, wrong schema shape.

The generation pipeline is a pure waterfall with a single catch boundary in the API route. Two `JSON.parse` calls are required — one for the OpenRouter envelope, one for `content`. The Astro virtual module `astro:env/server` is imported by the API route; it must be aliased to a static mock for tests to run outside the Astro runtime.

## Desired End State

`npm test` runs a suite of 17 tests (11 unit + 6 integration) that all pass. Each of the three code gaps is fixed and proven by a failing-then-passing test scenario. The 502 response body contains a fixed safe string, never a raw provider payload. Whitespace-only cards are rejected at the service layer. Fewer-than-requested cards throw `GenerationError`. A `test` step runs in CI before build.

### Key Discoveries

- `src/lib/services/generation.ts:18-25` — `CardSchema` and `ResponseSchema` are module-level; `ResponseSchema` must move inside `generateCards()` to reference the `count` parameter.
- `src/pages/api/generate.ts:47` — the interpolation `Generation failed: ${err.message}` is the single change needed for the 502 leak fix.
- `src/lib/api-utils.ts` — `json()` helper returns a native `Response`; integration tests can inspect `.status` and await `.json()` directly.
- The API route calls `createClient(context.request.headers, context.cookies)` (`generate.ts:54`). For integration tests, `createClient` must be module-mocked; for tests that return before the DB call (validation failures, GenerationError paths), no Supabase mock data is needed.
- Project is `"type": "module"` (ESM). `vitest.config.ts` must use `import.meta.url` for path resolution, not `__dirname`.
- `"vite": "^7.3.2"` is overridden in `package.json`. Install the latest Vitest and check for peer dependency warnings; npm will resolve Vite compatibility.

## What We're NOT Doing

- No React/DOM testing in Phase 1. The `GenerateForm.tsx:147` null-guard bug (`!== null` not catching `undefined`) is deferred to Phase 2.
- No e2e tests. Integration tests cover the API route by invoking `POST` directly — no HTTP server.
- No mocking of `SUPABASE_URL`/`SUPABASE_KEY` — these never reach the test path since `createClient` is mocked entirely.
- No testing of the OpenRouter happy path against the real API.
- No testing of the `503` missing-API-key path (configuration concern, not a Risk #1 or #7 scenario).
- No changes to `CurationPanel.tsx` or any UI component.

## Implementation Approach

Fix → then prove. Each code gap is fixed first, then the corresponding test is written against the fixed behaviour. Tests for already-protected paths (U1–U7 for existing error paths) document existing protection; tests for the three fixed gaps (U8, U9, I1) prove the fix works.

Integration tests invoke the exported `POST` async function directly with a minimal `APIContext` object. No HTTP server is started. Module-level `vi.mock()` replaces `generateCards` and `createClient` in the integration test file.

## Critical Implementation Details

**`ResponseSchema` must become function-local.** `CardSchema` is safe to remain module-level. `ResponseSchema` references `count` from the function parameter, so it must be constructed inside `generateCards()` after the `count` argument is available. Moving it does not change the Zod shape — only the definition site.

**Supabase mock chain for the happy-path integration test (I6).** The API route calls the Supabase client in two separate `.insert()` chains with different terminal calls: `.select().single()` for the `generations` table and `.select()` (no `.single()`) for the `flashcards` table. The mock must return the correct shape for each call. Use `mockReturnValueOnce` per-chain or a call-counter pattern to distinguish them.

**`astro:env/server` alias is load-bearing.** Without it, importing the API route in tests will attempt to bootstrap the Astro runtime and throw. The alias in `vitest.config.ts` must point to `src/__mocks__/astro-env-server.ts` and export `OPENROUTER_API_KEY = "test-key"`.

---

## Phase 1: Bootstrap Vitest

### Overview

Install Vitest, create the config with the `@/` path alias and `astro:env/server` mock alias, create the mock file, and wire a `test` script. This phase produces no test files — it only ensures `npm test` can be run.

### Changes Required

#### 1. Install Vitest

**File**: `package.json` (via `npm install`)

**Intent**: Add Vitest as a devDependency. Run `npm install -D vitest` and accept the version npm resolves. Check the output for peer dependency conflicts with `vite@^7.3.2`.

**Contract**: `"vitest": "<resolved-version>"` appears in `devDependencies`. No existing dependency version is downgraded.

#### 2. Create `vitest.config.ts`

**File**: `vitest.config.ts` (project root)

**Intent**: Configure Vitest with the `node` environment, the `@/` path alias mirroring `tsconfig.json`, and an alias that replaces the `astro:env/server` virtual module with a static mock file.

**Contract**: Config exports a Vitest config with `test.environment: "node"`. `resolve.alias` maps `"@/"` to `./src/` and `"astro:env/server"` to `./src/__mocks__/astro-env-server.ts`. Path resolution uses `fileURLToPath` + `import.meta.url` (ESM-safe, no `__dirname`). No `globals: true` — tests will use explicit imports from `"vitest"`.

#### 3. Create `src/__mocks__/astro-env-server.ts`

**File**: `src/__mocks__/astro-env-server.ts` (new file)

**Intent**: Provide a static export of all `astro:env/server` named exports so the API route can be imported in a test environment without triggering the Astro runtime.

**Contract**: Exports `OPENROUTER_API_KEY = "test-key"`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` matching the four schema fields declared in `astro.config.mjs`. Values are non-empty strings except `SUPABASE_SERVICE_ROLE_KEY` which may be `undefined`.

#### 4. Add `test` script to `package.json`

**File**: `package.json`

**Intent**: Expose `npm test` as the command for running the full suite in CI and locally.

**Contract**: `"scripts"` gains `"test": "vitest run"`. The `run` flag exits after one pass (no watch mode), suitable for CI.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with output `No test files found`
- `npm run lint` still passes (no new lint errors from new files)
- `npm run build` still passes

#### Manual Verification

- Running `npm test` locally exits 0 within a few seconds
- No Astro runtime errors in the test output

---

## Phase 2: Service-layer fixes + unit tests

### Overview

Apply two fixes to `generation.ts` and write 11 unit tests that prove the five error paths (already protected) and three fixed failure modes (gaps 2 and 3).

### Changes Required

#### 1. Fix `CardSchema` — add `.trim()` before `.min(1)`

**File**: `src/lib/services/generation.ts` (lines 18-22)

**Intent**: Reject whitespace-only card fields at the schema validation step. A string of spaces is trimmed to empty before the `min(1)` check fires, causing `ResponseSchema.safeParse` to fail and `generateCards()` to throw `GenerationError("Model response failed schema validation")`.

**Contract**: Both `front` and `back` validators become `z.string().trim().min(1)`. The `.trim()` transform is applied by Zod before length validation. The change is two characters per field; no other schema fields change.

#### 2. Move `ResponseSchema` inside `generateCards()` with dynamic `.min(count)`

**File**: `src/lib/services/generation.ts` (lines 22-25, 27)

**Intent**: Enforce that the model returns at least the number of cards requested, not just at least one. Moving the schema inside the function makes `count` available as the minimum.

**Contract**: The module-level `ResponseSchema` constant is removed. Inside `generateCards()`, after the function signature (before the system prompt), a new local `ResponseSchema` is defined as `z.object({ cards: z.array(CardSchema).min(count) })`. `CardSchema` remains module-level. The Zod parse call at line 77 uses the new local schema. Functionally, if the model returns fewer than `count` cards, `safeParse` fails and a `GenerationError("Model response failed schema validation")` is thrown.

#### 3. Create unit test file

**File**: `src/lib/services/__tests__/generation.test.ts` (new file)

**Intent**: Prove all five already-protected error paths and the two newly enforced validation scenarios. All tests mock `globalThis.fetch` — no real HTTP call is made.

**Contract**: One `describe("generateCards")` block. Uses `vi.stubGlobal("fetch", vi.fn())` in a `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`. Each test calls `generateCards(sourceText, count, "test-key")` and asserts the outcome.

Helper used throughout: a `mockFetch(overrides)` utility that returns a minimal `Response`-shaped object with `ok`, `status`, `json()`, and `text()` fields set to the given values, cast as `Response`.

Test cases (all must pass after fixes land):

- **U1** — `fetch` throws → `generateCards` rejects with `GenerationError`; message is `"Failed to reach OpenRouter"`.
- **U2** — `response.ok = false`, `status = 401`, `text() = '{"error":"Invalid API key"}'` → rejects with `GenerationError`; message contains `"401"`.
- **U3** — `response.ok = true`, `json()` throws → rejects with `GenerationError`; message contains `"parse"`.
- **U4** — `ok = true`, valid envelope but `choices: []` → rejects with `GenerationError`; message contains `"missing"`.
- **U5** — valid envelope, `content = "Sure! Here are cards..."` (not JSON) → rejects with `GenerationError`; message contains `"non-JSON"`.
- **U6** — valid envelope, `content = '{"flashcards":[]}'` (wrong key) → rejects with `GenerationError`; message contains `"schema"`.
- **U7** — `content = '{"cards":[]}'` (empty array when count=5) → rejects with `GenerationError` (`min(5)` now fails). *(Behaviour changed by fix 2: previously failed at `min(1)` on an empty array; now also enforces `min(count)`.)*
- **U8** — `content = '{"cards":[{"front":" ","back":"answer"}]}'`, count=1 → rejects with `GenerationError` (whitespace front trimmed to `""`). *(Fixed by fix 1.)*
- **U9** — `content` has 2 valid cards, count=5 → rejects with `GenerationError` (only 2 cards, `min(5)` fails). *(Fixed by fix 2.)*
- **U10** — `content` has exactly 5 valid cards, count=5 → resolves with an array of 5 `CardCandidate` objects.
- **U11** — `content` has 8 valid cards, count=5 → resolves with an array of exactly 5 (`.slice` works).

### Success Criteria

#### Automated Verification

- `npm test` passes with 11 tests in `generation.test.ts`, 0 failures
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- U8 and U9 would have been green before the fixes on the old code — confirm the fix is actually required by temporarily reverting one fix and seeing the test fail

---

## Phase 3: API route fix + integration tests

### Overview

Sanitize the 502 error response in the API route, then write 6 integration tests that invoke the `POST` handler directly without an HTTP server.

### Changes Required

#### 1. Fix 502 provider leak in `generate.ts`

**File**: `src/pages/api/generate.ts` (line 47)

**Intent**: Replace the interpolated `err.message` with a fixed generic string so raw OpenRouter response bodies never reach the client. The existing `console.error` log line (line 46) is kept — provider details remain visible on the server.

**Contract**: Line 47 changes from:
```
return json({ error: `Generation failed: ${err.message}` }, 502);
```
to:
```
return json({ error: "Generation failed — please try again." }, 502);
```
No other changes to the catch block. The 502 status code is preserved. The `err.message` and `err.cause` continue to be logged server-side.

#### 2. Create integration test file

**File**: `src/pages/api/__tests__/generate.test.ts` (new file)

**Intent**: Prove the request-validation boundary (Risk #7), the sanitized 502 error response (Risk #1 Gap 1), and the happy path. Invoke the `POST` handler directly; no HTTP server.

**Contract**: Two top-level `vi.mock()` calls at module scope:
- `vi.mock("@/lib/services/generation", ...)` — replaces `generateCards` with `vi.fn()`.
- `vi.mock("@/lib/supabase", ...)` — replaces `createClient` with `vi.fn()`.

Helper `makeCtx(body, user?)` constructs a minimal `APIContext`: a native `Request` with `method: "POST"`, `Content-Type: application/json`, and a JSON-stringified body; `locals.user` set to a default user object or `null`; `cookies` as an empty object cast to `AstroCookies`. The helper is typed to return `Parameters<typeof POST>[0]`.

Test cases:

- **I1** — `generateCards` is mocked to throw `new GenerationError("OpenRouter returned 401: {\"error\":{\"message\":\"Invalid API key\"}}")` → `POST` returns status 502; response body `error` field equals `"Generation failed — please try again."` and does NOT contain `"OpenRouter returned"` or `"Invalid API key"`.
- **I2** — `generateCards` throws `new Error("oops")` → status 500; `error` equals `"Unexpected error during generation"`.
- **I3** — body `{ sourceText: "x", count: 5 }` (too short) → status 400; `error` is a non-empty string.
- **I4** — body `{ sourceText: "x".repeat(10_001), count: 5 }` (too long) → status 400; `error` is a non-empty string.
- **I5** — body `{ sourceText: validText, count: 7 }` (invalid count) → status 400; `error` is a non-empty string.
- **I6** — `generateCards` resolves with 5 valid `CardCandidate[]`; `createClient` returns a mock Supabase client whose `generations` insert chain (`.insert().select().single()`) resolves `{ data: { id: "gen-1" }, error: null }` and whose `flashcards` insert chain (`.insert().select()`) resolves `{ data: [{ id: "c-1", front: "Q", back: "A", user_id: "u-1", generation_id: "gen-1", status: "draft", created_at: "2026-01-01", ... }], error: null }` → status 200; response body has `generationId = "gen-1"` and `cards` array of length 5.

For I6, the two Supabase chains return different shapes (`.single()` vs no single). Use `vi.fn().mockReturnValueOnce()` to sequence the two chain results, or use a call-counter approach in the factory.

### Success Criteria

#### Automated Verification

- `npm test` passes with all 17 tests (11 unit + 6 integration), 0 failures
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Manually verify in the browser that generating cards with a valid source text still works (the 502 message change and schema fixes must not break the happy path)
- Check the server log: on a real OpenRouter error, the raw provider body is logged but NOT returned to the browser

---

## Phase 4: CI wiring + §6 cookbook

### Overview

Wire the test step into CI and fill in the `§6` cookbook patterns in `test-plan.md` so future contributors know how to add tests.

### Changes Required

#### 1. Add `test` step to CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run the test suite on every push and PR, before the build step, without requiring SUPABASE_URL or SUPABASE_KEY (all dependencies are mocked).

**Contract**: Add `- run: npm test` after the `npm run lint` step and before `npm run build`. No `env:` block is needed on the test step. The final job step order becomes: `npm ci` → `astro sync` → `npm run lint` → `npm test` → `npm run build`.

#### 2. Update §6 cookbook in `test-plan.md`

**File**: `context/foundation/test-plan.md` (§6 sub-sections)

**Intent**: Replace "TBD — see §3 Phase N" placeholders with actionable patterns so contributors can add tests without reading all of research.md.

**Contract**: Update three sub-sections:

**§6.1 Adding a unit test**: Describe the `src/lib/services/__tests__/` pattern. Key points: import from `"vitest"`, use `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`, construct mock `Response` objects inline, assert on `GenerationError` message content (not exact wording), reset with `vi.unstubAllGlobals()` in `afterEach`.

**§6.2 Adding an integration test**: Describe the `src/pages/api/__tests__/` pattern. Key points: `vi.mock()` at module scope for `@/lib/services/generation` and `@/lib/supabase`, use `makeCtx()` helper, invoke the exported route handler directly, inspect the returned `Response` with `await response.json()`.

**§6.3 Adding a test for the LLM generation path**: Summarise the mock-at-HTTP-edge rule: never hit real OpenRouter in tests; mock `fetch` for unit tests of `generateCards()` and mock `generateCards` directly for API route integration tests. Reference U1–U11 and I1–I6 as the canonical examples.

### Success Criteria

#### Automated Verification

- CI workflow passes on push to the branch (lint → test → build all green)
- `npm run build` still passes with the `SUPABASE_URL` and `SUPABASE_KEY` secrets set

#### Manual Verification

- Open `context/foundation/test-plan.md §6` — each sub-section has actionable, example-backed guidance
- A new contributor can add a unit test for a new `generateCards()` edge case by reading §6.1 alone

---

## Testing Strategy

### Unit Tests

- 11 tests in `src/lib/services/__tests__/generation.test.ts`
- All mock `globalThis.fetch`; no real network calls
- Coverage: network failure, HTTP non-OK, JSON parse failures (envelope + content), schema validation failures, whitespace rejection, count shortfall, truncation, happy path

### Integration Tests

- 6 tests in `src/pages/api/__tests__/generate.test.ts`
- Mock `generateCards` and `createClient` at module level
- Coverage: provider error sanitization, unexpected error, input validation (3 cases), happy path

### Manual Testing

1. Start dev server (`npm run dev`)
2. Generate a deck with valid source text — confirm cards appear and curation works
3. Check server logs after a real API call — confirm no crash
4. In browser DevTools, confirm the 502 response body does not contain raw OpenRouter JSON if generation is manually triggered to fail (e.g., temporarily pass an invalid API key)

## Migration Notes

No database migrations. No schema changes. The `CardSchema` `.trim()` change affects in-memory Zod parsing only — no persisted data changes. The 502 error message change is backwards-compatible with the UI, which shows `data.error` verbatim and already has a fallback string.

## References

- Research: `context/changes/testing-bootstrap-generation-resilience/research.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #1, #7; §3 Phase 1; §6
- Lessons: `context/foundation/lessons.md` — "Do not expose upstream provider errors" and "Normalize and validate model output"
- Generation service: `src/lib/services/generation.ts:8-82`
- API route: `src/pages/api/generate.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bootstrap Vitest

#### Automated

- [x] 1.1 `npm test` exits 0 with "No test files found" — 2593033
- [x] 1.2 `npm run lint` passes after new files added — 2593033
- [x] 1.3 `npm run build` passes — 2593033

#### Manual

- [x] 1.4 `npm test` runs locally without Astro runtime errors — 2593033

### Phase 2: Service-layer fixes + unit tests

#### Automated

- [x] 2.1 `npm test` passes with 11 tests, 0 failures — 0c6f5a7
- [x] 2.2 `npm run lint` passes — 0c6f5a7
- [x] 2.3 `npm run build` passes — 0c6f5a7

#### Manual

- [x] 2.4 Temporarily revert one fix — confirm the corresponding test fails (proves tests catch the bug) — 0c6f5a7

### Phase 3: API route fix + integration tests

#### Automated

- [x] 3.1 `npm test` passes with all 17 tests, 0 failures — 67a4836
- [x] 3.2 `npm run lint` passes — 67a4836
- [x] 3.3 `npm run build` passes — 67a4836

#### Manual

- [x] 3.4 Dev server: generate a deck with valid source text — happy path works
- [x] 3.5 Verify server logs show provider error details, browser does not

### Phase 4: CI wiring + §6 cookbook

#### Automated

- [x] 4.1 CI workflow passes (lint → test → build all green) on push — 09454a8
- [x] 4.2 `npm run build` passes with SUPABASE secrets set — 921e097

#### Manual

- [x] 4.3 `context/foundation/test-plan.md §6` sub-sections are actionable without reading research.md — 921e097
