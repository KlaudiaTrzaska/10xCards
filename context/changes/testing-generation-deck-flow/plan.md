# Generation & Deck Flow Integration Tests — Implementation Plan

## Overview

Phase 2 of the test rollout (see `context/foundation/test-plan.md §3`). Adds integration tests for the curation → save-deck → deck CRUD call chain, protecting Risks #2 and #5. Also closes the server-side whitespace-only edit gap (documented in `lessons.md`) as a prerequisite fix before testing it.

No new infrastructure is needed — Phase 1 bootstrapped Vitest, the `makeCtx` helper pattern, and the `vi.mock("@/lib/supabase")` approach. Phase 2 extends that pattern across three new test files.

## Current State Analysis

Three route files have zero test coverage:
- `src/pages/api/save-deck.ts` — `POST /api/save-deck` (curation commit)
- `src/pages/api/deck/index.ts` — `GET /api/deck` (paginated list) + `POST /api/deck` (manual create)
- `src/pages/api/deck/[id].ts` — `PATCH /api/deck/[id]` (edit) + `DELETE /api/deck/[id]` (delete)

One open code gap:
- `save-deck.ts` `RequestSchema` accepts whitespace-only strings for `edited[].front/back` because zod `min(1)` counts whitespace characters. `lessons.md:40-45` flags this.

### Key Discoveries

- `src/pages/api/__tests__/generate.test.ts:1-165` — canonical Phase 1 pattern: two `vi.mock()` calls at module scope, `makeCtx()` helper, invoke exported handler, inspect `res.status` + `await res.json()`. **Follow exactly.**
- `src/pages/api/save-deck.ts:51-93` — three sequential Supabase mutations (delete → bulk update → Promise.all update). No transaction. The mock must distinguish these three steps to test failure paths.
- `src/pages/api/deck/[id].ts:15-53` — shared `fetchCardForMutation()` helper runs a `maybeSingle()` select before any mutation; mock needs two-call support (select then mutate).
- `src/pages/api/deck/index.ts:22` — `GET` reads `context.url.searchParams`, not `context.request.url`. The `makeGetCtx()` helper must include a `url` property.
- `src/pages/api/deck/[id].ts:55-128` — both `PATCH` and `DELETE` read `context.params.id`. The makeCtx for this route needs a `params` property.
- `src/pages/api/__tests__/generate.test.ts:64-68` — `interface ApiBody` pattern satisfies `@typescript-eslint/no-unsafe-member-access`; replicate per test file.
- `context/foundation/test-plan.md:75` — Risk #5 anti-pattern: "Mocking DB to always succeed." Tests for partial-save must mock each step to fail independently and assert the 500 response; a comment in the test must document that the mock does not prove DB-level all-or-nothing (no Postgres transaction exists).

## Desired End State

Five new test cases covering save-deck whitespace validation (S4), plus full branch coverage of all three route files. Running `npm test` passes with no failures. `test-plan.md §6.4` is filled in with canonical save-deck patterns. The whitespace-only edit gap is closed at the server boundary.

### Key Discoveries (implementation-relevant)

- `src/pages/api/save-deck.ts:13,14` — the two lines to change for the trim fix: `z.string().min(1).max(1000)` → `z.string().trim().min(1).max(1000)` on `front` and `back` inside the `edited` array schema.
- `src/pages/api/deck/[id].ts:32-38` — `fetchCardForMutation` first calls `maybeSingle()` (returns `{ data: card | null, error }`), then the caller makes a second Supabase call. The mock factory must return the right value for each call by tracking call index.
- `src/lib/api-utils.ts` — `json()` helper used by all routes. No change needed but confirms test can call `await res.json()` directly.

## What We're NOT Doing

- **No React / DOM tests** — CurationPanel component is out of scope. Phase 2 covers API routes only (test plan §7 and Phase 1 precedent).
- **No fix for savedCount over-reporting** — `savedCount` is computed from input array lengths, not affected rows. Known gap; deferred to a dedicated fix change.
- **No Postgres RPC / DB-level atomicity fix** — save-deck stays non-atomic. Tests document the existing 500-on-failure behavior with comments explaining the limitation.
- **No GenerateForm null-guard fix** — deferred gap from Phase 1; still out of scope.
- **No e2e or browser tests** — cost × signal principle; integration tests catch these regressions.
- **No new migrations** — the whitespace fix is schema-free (zod trim only).

## Implementation Approach

Fix-then-prove for the whitespace gap (fix `save-deck.ts` before writing S4 so the test starts green, not red). For all other paths, write the test first against the existing behavior — no other code changes needed.

Four-phase delivery: save-deck (fix + test), deck index (test), deck [id] (test), cookbook update (docs).

Mock strategy:
- `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` at module scope in every test file.
- Each test file defines a `make<Route>Supabase(opts)` factory that controls per-step error injection.
- `makeCtx()` variants differ per route: POST routes pass a JSON body; GET deck passes a `url` with search params; `[id]` routes pass `params: { id }`.

## Critical Implementation Details

**`context.url` in GET /api/deck.** The route reads `context.url.searchParams`, which is `AstroGlobal.url` (a `URL` object), not derivable from `context.request.url` alone. The `makeGetCtx` helper must set `url: new URL("http://localhost/api/deck?page=N")` explicitly alongside `request`.

**Two-call Supabase mock for `[id].ts`.** `fetchCardForMutation` issues a `.select().maybeSingle()` as the first Supabase call; `PATCH` or `DELETE` issues a second call. The factory tracks `fromCallCount` to route the two calls to the correct mock data.

**Three-call Supabase mock for `save-deck.ts`.** The three sequential steps (delete, bulk-update, Promise.all-update) all call `from("flashcards")`. The factory tracks call index (1 = discard, 2 = accept, 3+ = edit) to inject errors independently. A comment on S8 and S9 must note that in a real DB, prior steps would have committed even when the mock returns the full 500 path.

---

## Phase 1: save-deck whitespace fix + integration tests

### Overview

Close the server-side whitespace gap in `save-deck.ts`, then write full integration tests for `POST /api/save-deck` covering auth, zod validation (including the new trim), happy paths, and each of the three DB failure paths.

### Changes Required

#### 1. Trim fix in save-deck RequestSchema

**File**: `src/pages/api/save-deck.ts`

**Intent**: Apply `.trim()` before `.min(1)` on `edited[].front` and `edited[].back` so that whitespace-only strings fail validation instead of reaching the DB. This is the server-side half of the fix documented in `lessons.md:40-45`.

**Contract**: Lines 13 and 14 of `RequestSchema` change from `z.string().min(1).max(1000)` to `z.string().trim().min(1).max(1000)`. Zod `.trim()` strips leading/trailing whitespace before length validation; the trimmed value is what gets saved.

#### 2. Integration tests — POST /api/save-deck

**File**: `src/pages/api/__tests__/save-deck.test.ts`

**Intent**: Cover all meaningful branches of `POST /api/save-deck` following the Phase 1 `generate.test.ts` pattern. Tests are numbered S1–S9 to align with the §6.4 cookbook entry.

**Contract**:

Module-scope mocks (hoisted):
```typescript
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
```

`makeCtx(body, user?)` — same shape as `generate.test.ts:70-80` but URL is `http://localhost/api/save-deck`.

`makeSaveDeckSupabase({ discardError?, acceptError?, editError? })` factory — tracks `from()` call count to route errors: 1st call is discard (delete chain), 2nd call is accept (update+in chain), 3rd+ calls are edit (update+eq chain). Each chain must be thenable (returns `Promise<{ error: Error | null }>`).

`interface SaveDeckBody { savedCount?: number; error?: string }` for typed `res.json()` results.

Test cases:

| ID | Scenario | Expected |
|----|----------|----------|
| S1 | No user (`user: null`) | 401 |
| S2 | Malformed JSON body | 400 |
| S3 | All discarded, zero accepted/edited (refine fails) | 400 with refine message |
| S4 | `edited[0].front` is `"   "` (whitespace-only) | 400 (proves trim fix) |
| S5 | `accepted: [uuid]`, empty edited/discarded | 200, `savedCount: 1` |
| S6 | Mix: accepted + edited + discarded; Supabase returns no error | 200, `savedCount: accepted.length + edited.length` |
| S7 | Discard step fails (`discardError = new Error(...)`) | 500 |
| S8 | Accept step fails (`acceptError = new Error(...)`) — comment: discard already committed in real DB | 500 |
| S9 | Edited step fails (`editError = new Error(...)`) — comment: discard + accept already committed in real DB | 500 |

### Success Criteria

#### Automated Verification

- `npm run lint` — no new lint errors
- `npm test` — all S1–S9 pass
- `npm run build` — build still green

#### Manual Verification

- Confirm `src/pages/api/__tests__/save-deck.test.ts` exists with 9 test cases
- Confirm the trim fix is visible in `save-deck.ts` line 13-14

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Deck list + create integration tests

### Overview

Write integration tests for `GET /api/deck` and `POST /api/deck`. The GET handler needs a `url` property in the context; the POST follows the same POST pattern as Phase 1.

### Changes Required

#### 1. Integration tests — GET + POST /api/deck

**File**: `src/pages/api/__tests__/deck-index.test.ts`

**Intent**: Cover all meaningful branches of `GET /api/deck` (paginated list with `context.url.searchParams`) and `POST /api/deck` (manual card create). Tests numbered D1–D8.

**Contract**:

Module-scope mock:
```typescript
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
```

`makeGetCtx(page?, user?)` — sets both `request` and `url`:
```typescript
function makeGetCtx(page?: number, user = { id: "u-1" }) {
  const url = new URL(`http://localhost/api/deck${page !== undefined ? `?page=${page}` : ""}`);
  return {
    request: new Request(url.toString(), { method: "GET" }),
    url,
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}
```

`makePostCtx(body, user?)` — same as `generate.test.ts:70-80` shape, URL is `http://localhost/api/deck`, method POST.

`makeDeckListSupabase({ data?, count?, error? })` — returns the nested chain that terminates in `{ data, count, error }` from `.from("flashcards").select(...).eq(...).eq(...).order(...).range(...)`.

`makeCreateSupabase({ data?, error? })` — returns the chain terminating in `{ data, error }` from `.from("flashcards").insert({...}).select().single()`.

`interface DeckIndexBody { cards?: unknown[]; total?: number; page?: number; pageSize?: number; card?: unknown; error?: string }`.

Test cases:

| ID | Scenario | Expected |
|----|----------|----------|
| D1 | GET — no user | 401 |
| D2 | GET — `?page=abc` (invalid) | 400 |
| D3 | GET — happy path, page 1 | 200, `{ cards: [...], total, page: 1, pageSize: 20 }` |
| D4 | GET — Supabase error | 500 |
| D5 | POST — no user | 401 |
| D6 | POST — missing `front` field | 400 |
| D7 | POST — happy path | 201, `{ card: { front, back, status: "accepted" } }` |
| D8 | POST — Supabase insert error | 500 |

### Success Criteria

#### Automated Verification

- `npm run lint` — no new lint errors
- `npm test` — all D1–D8 pass (S1–S9 still green)

#### Manual Verification

- Confirm `src/pages/api/__tests__/deck-index.test.ts` exists with 8 test cases

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Deck edit + delete integration tests

### Overview

Write integration tests for `PATCH /api/deck/[id]` and `DELETE /api/deck/[id]`. Both handlers call `fetchCardForMutation()` as a first step (a `maybeSingle()` select), then issue a second Supabase call for the actual mutation. The mock must handle both steps.

### Changes Required

#### 1. Integration tests — PATCH + DELETE /api/deck/[id]

**File**: `src/pages/api/__tests__/deck-id.test.ts`

**Intent**: Cover all branches of `PATCH` and `DELETE /api/deck/[id]` including auth, invalid UUID, 404, 403 lock, happy path, and DB error. Tests numbered E1–E12.

**Contract**:

Module-scope mock:
```typescript
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
```

`VALID_ID = "00000000-0000-0000-0000-000000000001"` — a constant valid UUID to use as the default card id.

`makePatchCtx(body, user?, id?)` — includes `params: { id }`:
```typescript
function makePatchCtx(body: unknown, user = { id: "u-1" }, id = VALID_ID) {
  return {
    request: new Request(`http://localhost/api/deck/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}
```

`makeDeleteCtx(user?, id?)` — same shape, no body, method DELETE.

`makeDeckIdSupabase({ selectData?, selectError?, mutateData?, mutateError? })` factory — tracks `from()` call count: 1st call is `fetchCardForMutation` (the select chain returning `{ data: selectData, error: selectError }`); 2nd call is the actual update or delete chain (returning `{ data: mutateData, error: mutateError }`).

`selectData` shapes for lock/not-found/unlocked scenarios:
- `null` → 404
- `{ id: VALID_ID, user_id: "u-1", first_reviewed_at: "2026-01-01", status: "accepted" }` → 403
- `{ id: VALID_ID, user_id: "u-1", first_reviewed_at: null, status: "accepted" }` → unlocked (proceed)

`interface DeckIdBody { card?: unknown; error?: string }`.

Test cases:

| ID | Method | Scenario | Expected |
|----|--------|----------|----------|
| E1 | PATCH | Invalid UUID in params | 400 |
| E2 | PATCH | No user | 401 |
| E3 | PATCH | Empty front field | 400 |
| E4 | PATCH | Card not found (`selectData: null`) | 404 |
| E5 | PATCH | Card locked (`first_reviewed_at` set) | 403 |
| E6 | PATCH | Happy path (unlocked card) | 200, `{ card: { front, back } }` |
| E7 | PATCH | Supabase mutate error | 500 |
| E8 | DELETE | Invalid UUID in params | 400 |
| E9 | DELETE | No user | 401 |
| E10 | DELETE | Card not found | 404 |
| E11 | DELETE | Card locked | 403 |
| E12 | DELETE | Happy path | 204 |

### Success Criteria

#### Automated Verification

- `npm run lint` — no new lint errors
- `npm test` — all E1–E12 pass (S1–S9, D1–D8 still green)

#### Manual Verification

- Confirm `src/pages/api/__tests__/deck-id.test.ts` exists with 12 test cases
- Total test count across Phase 2 files: S1–S9 + D1–D8 + E1–E12 = 29 new tests

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Cookbook update

### Overview

Fill in `§6.4` of `context/foundation/test-plan.md` with canonical save-deck test patterns, mirroring `§6.2`. Update the Phase 2 rollout row status to `complete` once all prior phases pass.

### Changes Required

#### 1. Fill in §6.4 in test-plan.md

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.4 TBD` placeholder with a concise how-to that matches the level of §6.2 and §6.3 — file location, mock structure, `makeCtx` variant, and a pointer to canonical test IDs.

**Contract**: Replace lines 198-200 (the `§6.4 Adding a test for the curation → save-deck flow` section body "TBD — see §3 Phase 2 (Generation & deck flow integration).") with:

```markdown
Place new save-deck integration test files under `src/pages/api/__tests__/`.

Key conventions:

- Two `vi.mock()` calls at module scope (hoisted):
  - `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))`.
- Build a `makeSaveDeckSupabase({ discardError?, acceptError?, editError? })` factory that tracks `from()` call count to inject errors at the discard (1st), accept (2nd), or edit (3rd+) step independently. Each error parameter is `Error | null`.
- Build a `makeCtx(body, user?)` helper that constructs a native `Request` with `method: "POST"`, `Content-Type: application/json`, and `body: JSON.stringify(body)`. Cast to `Parameters<APIRoute>[0]` via `as unknown as Parameters<APIRoute>[0]`.
- When testing the partial-save error paths (DB error on step 2 or 3), add a comment stating that the mock does not prove DB-level all-or-nothing atomicity — in a real database, prior steps would have committed.
- Canonical examples: `src/pages/api/__tests__/save-deck.test.ts` (tests S1–S9).
```

#### 2. Update Phase 2 rollout row status

**File**: `context/foundation/test-plan.md`

**Intent**: Advance the Phase 2 row from `change opened` to `complete` once all prior phases pass.

**Contract**: Change the `Status` cell of the Phase 2 row from `change opened` to `complete`.

### Success Criteria

#### Automated Verification

- `npm run lint` — no new lint errors
- `npm test` — all 29 new tests + existing Phase 1 tests pass

#### Manual Verification

- Confirm `§6.4` in `test-plan.md` is filled in (not "TBD")
- Confirm Phase 2 row in §3 rollout table reads `complete`

---

## Testing Strategy

### Integration Tests

- **S1–S9**: `src/pages/api/__tests__/save-deck.test.ts` — `POST /api/save-deck` full branch coverage
- **D1–D8**: `src/pages/api/__tests__/deck-index.test.ts` — `GET + POST /api/deck` full branch coverage
- **E1–E12**: `src/pages/api/__tests__/deck-id.test.ts` — `PATCH + DELETE /api/deck/[id]` full branch coverage

### Manual Testing Steps

1. Run `npm test` and confirm all 29 new tests plus the 17 Phase 1 tests pass
2. In the dev environment, paste source text → generate → accept some cards → discard some → save → confirm redirect to `/deck?saved=N`
3. On the deck page, edit an accepted card and verify save works; delete a card and verify removal

## References

- Research: `context/changes/testing-generation-deck-flow/research.md`
- Phase 1 canonical tests: `src/pages/api/__tests__/generate.test.ts`
- Test plan §6.2: `context/foundation/test-plan.md:179-188`
- Test plan §6.3: `context/foundation/test-plan.md:191-196`
- save-deck route: `src/pages/api/save-deck.ts`
- deck index route: `src/pages/api/deck/index.ts`
- deck [id] route: `src/pages/api/deck/[id].ts`
- Whitespace gap lesson: `context/foundation/lessons.md:40-45`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: save-deck whitespace fix + integration tests

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors
- [x] 1.2 `npm test` — S1–S9 all pass

#### Manual

- [x] 1.3 `src/pages/api/__tests__/save-deck.test.ts` exists with 9 test cases
- [x] 1.4 `save-deck.ts` lines 13-14 use `.trim().min(1).max(1000)` for both `front` and `back`

### Phase 2: Deck list + create integration tests

#### Automated

- [ ] 2.1 `npm run lint` passes with no new errors
- [ ] 2.2 `npm test` — D1–D8 all pass (S1–S9 still green)

#### Manual

- [ ] 2.3 `src/pages/api/__tests__/deck-index.test.ts` exists with 8 test cases

### Phase 3: Deck edit + delete integration tests

#### Automated

- [ ] 3.1 `npm run lint` passes with no new errors
- [ ] 3.2 `npm test` — E1–E12 all pass (S1–S9, D1–D8 still green)

#### Manual

- [ ] 3.3 `src/pages/api/__tests__/deck-id.test.ts` exists with 12 test cases
- [ ] 3.4 Total new test count: 29 (S + D + E combined)

### Phase 4: Cookbook update

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 `npm test` — full suite green (no regressions)

#### Manual

- [ ] 4.3 `§6.4` in `test-plan.md` is filled in (not "TBD")
- [ ] 4.4 Phase 2 row in §3 rollout table reads `complete`
