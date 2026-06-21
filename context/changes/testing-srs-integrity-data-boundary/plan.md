# SRS Integrity and Cross-User Data Boundary — Integration Tests (Phase 3)

## Overview

Phase 3 of the test rollout (see `context/foundation/test-plan.md §3`). Adds integration tests for `POST /api/study/review` (Risks #3 and #4) and `GET /api/study/due` (minimal), then fills in the §6.5 cookbook pattern. No new code or infrastructure — extends the `vi.mock("@/lib/supabase")` + `makeCtx` + direct-handler-invocation pattern from Phases 1 and 2.

## Current State Analysis

Two study route files have zero test coverage:
- `src/pages/api/study/review.ts` — `POST /api/study/review` (grade submission)
- `src/pages/api/study/due.ts` — `GET /api/study/due` (session load)

`src/lib/services/srs.ts` also has no tests; however, the scheduler is exercised end-to-end via the review API integration tests (decided in planning: no separate srs.ts unit tests).

No `src/pages/api/__tests__/study/` directory exists — Phase 3 creates it.

### Key Discoveries

- `src/pages/api/study/review.ts:42-48` — ownership-scoped SELECT: `.eq("id", cardId).eq("user_id", user.id).eq("status", "accepted").single()` returns 404 on any miss (not-owned, draft, missing). This is the IDOR defence at the app level; RLS enforces the same at the DB level.
- `src/pages/api/study/review.ts:74-86` — INSERT `review_logs` **before** UPDATE `flashcards`. If INSERT succeeds but UPDATE fails, the log is persisted (non-atomic by design, documented in code comment). Tests must document this with a comment, not assert atomicity.
- `src/lib/services/srs.ts:69-103` — `buildScheduledReview` uses `OUTCOME_INTERVAL_DAYS` lookup (again=1, hard=2, good=3, easy=5 days). `ts-fsrs` provides only `Rating`/`State` constants. Tests must derive expected values from this table, not from ts-fsrs.
- `src/pages/api/study/review.ts:94` — `first_reviewed_at` COALESCE: `card.first_reviewed_at ?? now.toISOString()`. If a card has already been reviewed, the original timestamp is preserved. Tests must verify this is not overwritten.
- `src/pages/api/study/due.ts:49-64` — three parallel `Promise.all` queries, all `from("flashcards")`. Due mock needs `fromCallCount` routing for call 1 (due cards + count), call 2 (total accepted count), call 3 (next due at via `fetchNextDueAt`).
- `src/pages/api/__tests__/generate.test.ts:1-165` — canonical Phase 1 pattern to follow exactly.
- `src/pages/api/__tests__/save-deck.test.ts:44-95` — `makeSaveDeckSupabase` call-count factory precedent.
- `vitest.config.ts:9` — `environment: "node"`, no globals. Explicit named imports required.
- UUID rule: RFC 4122-compliant (version nibble `[1-8]`, variant nibble `[89abAB]`) — Zod v4 rejects non-standard UUIDs.
- `src/__mocks__/astro-env-server.ts` — already wired for `astro:env/server`; no setup needed.

## Desired End State

`npm test` passes with zero failures. Two new test files exist under `src/pages/api/__tests__/study/`: `review.test.ts` (tests R1–R10) and `due.test.ts` (tests D1–D2). `test-plan.md §6.5` documents the canonical review test pattern. `test-plan.md §3` Phase 3 row is marked `complete`.

## What We're NOT Doing

- **No srs.ts unit tests** — the custom scheduler is exercised end-to-end; dedicated unit tests add coverage but no new signal for Risks #3/#4.
- **No full due-endpoint coverage** — minimal only (401 + happy-path). Full error-path and pagination tests are out of scope.
- **No React/DOM tests** — `StudySession.tsx` double-submit gap is a UI concern; this is API integration tests only.
- **No double-submit idempotency fix** — the `useRef` guard gap (lessons.md:34-38) is a UI fix in a separate change.
- **No Postgres RPC or atomicity fix** — review stays non-atomic; tests document the existing behavior.
- **No new migrations** — the review API is correct as-is.

## Implementation Approach

Three-phase delivery matching Phase 2's pattern: review tests (the bulk), due tests (minimal), cookbook + status update (docs).

Mock strategy inherits from Phase 2:
- `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` at module scope (hoisted by Vitest).
- Per-file `makeReviewSupabase` / `makeDueSupabase` factory functions that control per-step error injection via call-count tracking.
- `makeCtx(body, user?)` builds a native `Request` with `method: "POST"`, `Content-Type: application/json`, and `body: JSON.stringify(body)`. Cast to `Parameters<APIRoute>[0]` via `as unknown as`.
- Invoke exported handler directly; inspect `res.status` and `await res.json()`.

---

## Phase 1: POST /api/study/review integration tests

### Overview

Creates `src/pages/api/__tests__/study/review.test.ts` with ten tests (R1–R10) covering auth, input validation, ownership/IDOR, happy paths for first and subsequent reviews, edge cases, and both error paths of the non-atomic write sequence.

### Changes Required

#### 1. New directory

**Intent**: Create the `__tests__/study/` directory by placing the first test file inside it.

**Contract**: `src/pages/api/__tests__/study/` (new directory, created implicitly by writing the test file).

---

#### 2. UUID constants and mock card fixtures

**File**: `src/pages/api/__tests__/study/review.test.ts`

**Intent**: Define shared constants for user IDs and card IDs following the RFC 4122 UUID rule, and a `MOCK_CARD` fixture for the happy-path scenarios.

**Contract**: Two user ID constants (`USER_A_ID`, `USER_B_ID`), one card ID (`CARD_ID`). Two card fixtures: `MOCK_CARD_NEW` (`fsrs_state: null`, all other fsrs fields `null`, `first_reviewed_at: null`) for the first-review path; `MOCK_CARD_REVIEWED` (`fsrs_state: 3`, `fsrs_reps: 1`, `fsrs_lapses: 0`, `first_reviewed_at: "2026-01-01T00:00:00.000Z"`) for the re-review and COALESCE paths.

---

#### 3. `makeReviewSupabase` factory

**File**: `src/pages/api/__tests__/study/review.test.ts`

**Intent**: Build a Supabase mock that routes the three sequential calls in `review.ts` to the correct stub — SELECT (call 1), INSERT (call 2), UPDATE (call 3) — and allows per-step error injection.

**Contract**: `makeReviewSupabase({ card?, insertError?, updateError? })` where `card` defaults to `MOCK_CARD_NEW` (pass `null` to simulate not-found/IDOR). Returns `{ from: vi.fn() }` with internal `callCount` tracked per invocation. Call 1 (`from("flashcards")`) routes to the SELECT chain ending in `.single()` → `Promise.resolve({ data: card, error: card ? null : { code: "PGRST116" } })`. Call 2 (`from("review_logs")`) routes to `.insert({}) → Promise.resolve({ error: insertError ?? null })`. Call 3 (`from("flashcards")`) routes to the UPDATE chain ending in the final `.eq()` → `Promise.resolve({ error: updateError ?? null })`.

Note: the chain depth for each call must match what the handler actually calls. Verify against `src/pages/api/study/review.ts` before implementation. The `makeSaveDeckSupabase` pattern in `src/pages/api/__tests__/save-deck.test.ts:44-95` is the direct precedent.

---

#### 4. `makeCtx` helper

**File**: `src/pages/api/__tests__/study/review.test.ts`

**Intent**: Construct a minimal API context for the review POST route, following the exact same pattern as Phase 1/2 test files.

**Contract**: `makeCtx(body: unknown, user: { id: string } | null = { id: USER_A_ID })` — constructs a native `Request` with `method: "POST"`, `headers: { "Content-Type": "application/json" }`, `body: JSON.stringify(body)`, and `locals: { user }`, cast to `Parameters<APIRoute>[0]`.

---

#### 5. Module mock at top of file

**File**: `src/pages/api/__tests__/study/review.test.ts`

**Intent**: Mock `@/lib/supabase` at module scope so Vitest hoists it before any imports execute.

**Contract**: `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` — identical to the pattern in `generate.test.ts:9-10` and `save-deck.test.ts:10`.

---

#### 6. Tests R1–R10

**File**: `src/pages/api/__tests__/study/review.test.ts`

**Intent**: Ten integration tests covering all meaningful branches of `POST /api/study/review`.

**Contract** (test IDs, names, and what each asserts):

| ID | Name | Setup | Expected |
|----|------|-------|----------|
| R1 | no user → 401 | `makeCtx({...}, null)` | `status 401`, body `{ error: "Unauthorized" }` |
| R2 | invalid cardId → 400 | `cardId: "not-a-uuid"` | `status 400` |
| R3 | invalid outcome → 400 | `outcome: "perfect"` | `status 400` |
| R4 | card not found / IDOR → 404 | `makeReviewSupabase({ card: null })`, user = USER_B_ID; payload uses CARD_ID owned by USER_A | `status 404`, no INSERT called on `review_logs` |
| R5 | first review happy path → 200 | `MOCK_CARD_NEW` (fsrs_state null), outcome `"good"` | `status 200`, body `{ scheduledFor: <3 days from now>, outcome: "good" }` |
| R6 | re-review reps increment → 200 | `MOCK_CARD_REVIEWED` (fsrs_reps: 1), outcome `"hard"` | `status 200`; verify UPDATE was called (INSERT + UPDATE both invoked) |
| R7 | "again" → lapses increment → 200 | `MOCK_CARD_REVIEWED` (fsrs_lapses: 0), outcome `"again"` | `status 200` |
| R8 | first_reviewed_at preserved → 200 | `MOCK_CARD_REVIEWED` (`first_reviewed_at` already set), outcome `"easy"` | `status 200`; if testing UPDATE args: assert `first_reviewed_at` equals the card's existing value, not a new timestamp |
| R9 | INSERT review_log fails → 500 | `makeReviewSupabase({ insertError: new Error("db error") })` | `status 500`, body `{ error: "Failed to record review" }` |
| R10 | INSERT ok, UPDATE fails → 500 | `makeReviewSupabase({ updateError: new Error("db error") })` | `status 500`, body `{ error: "Failed to update card schedule" }`; add comment: "The review_logs INSERT already persisted — this documents the non-atomic design (review.ts:74-76). In production, the user would re-grade and a second log would be created." |

For R4, assert explicitly that the `from("review_logs")` call count is 0 — the ownership check must block before any INSERT. Use a spy on the mock to count calls.

For R5–R7, the test need not inspect every UPDATE argument field — asserting `status 200` and that both INSERT and UPDATE were called is sufficient signal for the integration tier (not an implementation mirror).

For R8, checking `first_reviewed_at` in the UPDATE call is the cheapest way to prove COALESCE works; alternatively, the test can just assert `status 200` and leave the COALESCE to be confirmed in the `srs.ts` code review.

Type the parsed response body with a local interface (e.g., `interface ReviewBody { scheduledFor?: string; outcome?: string; error?: string }`) to satisfy `@typescript-eslint/no-unsafe-member-access`.

### Success Criteria

#### Automated Verification

- `npm test` passes with no failures
- `npm run lint` passes on the new file (no ESLint errors)
- `npm run build` still passes (test files are excluded from build)

#### Manual Verification

- Inspect R4 to confirm the IDOR scenario is modelled with explicit USER_A / USER_B constants and a comment naming it as the IDOR proof
- Confirm R10 carries the non-atomic comment

**Implementation Note**: Pause after Phase 1 to confirm tests pass and the IDOR / non-atomic scenarios read clearly before writing Phase 2.

---

## Phase 2: GET /api/study/due minimal tests

### Overview

Creates `src/pages/api/__tests__/study/due.test.ts` with two tests (D1, D2). Minimal coverage — 401 and happy-path only — proving auth is enforced and the user-scoped query returns cards.

### Changes Required

#### 1. `makeDueSupabase` factory and helpers

**File**: `src/pages/api/__tests__/study/due.test.ts`

**Intent**: Build a Supabase mock for the three parallel `Promise.all` queries in `GET /api/study/due`: due cards (call 1), total accepted count (call 2), and `fetchNextDueAt` (call 3).

**Contract**: `makeDueSupabase({ cards?, totalAccepted?, nextDue? })` with defaults: `cards = [MOCK_STUDY_CARD]`, `totalAccepted = 1`, `nextDue = null`. Call 1 ends in `.limit()` → `Promise.resolve({ data: cards, count: cards.length, error: null })`; call 2 ends in `.head: true` → `Promise.resolve({ count: totalAccepted, error: null })`; call 3 ends in `.maybeSingle()` → `Promise.resolve({ data: nextDue ? { fsrs_due: nextDue } : null, error: null })`.

`MOCK_STUDY_CARD` is a minimal `StudyCardDTO`-shaped object with `id`, `front`, `back`, `user_id`, and all `fsrs_*` fields null (representing an unreviewed accepted card). Provide an `interval_previews` field with all four outcomes to match the DTO shape.

**`makeGetCtx` helper**: `makeGetCtx(user?)` — sets `request: new Request("http://localhost/api/study/due")`, `url: new URL("http://localhost/api/study/due")` (required for `context.url.searchParams`), `locals: { user }`, `cookies: {}`. Cast to `Parameters<APIRoute>[0]`. Follows the `makeGetCtx` precedent from `deck-index.test.ts`.

#### 2. Tests D1–D2

**File**: `src/pages/api/__tests__/study/due.test.ts`

**Intent**: Verify auth gate and user-scoped happy path.

**Contract**:

| ID | Name | Setup | Expected |
|----|------|-------|----------|
| D1 | no user → 401 | `makeGetCtx(null)` | `status 401`, body `{ error: "Unauthorized" }` |
| D2 | happy path → 200 | `makeGetCtx()`, `makeDueSupabase()` | `status 200`, body has `cards`, `total_due`, `total_accepted`, `next_due_at` |

### Success Criteria

#### Automated Verification

- `npm test` passes with no failures
- `npm run lint` passes on the new file

#### Manual Verification

- D2 response shape matches `StudyDueResponseDTO` (cards array, counts, next_due_at)

---

## Phase 3: Cookbook update and test-plan status

### Overview

Fills in `test-plan.md §6.5` with the canonical SRS review test pattern, then marks §3 Phase 3 `complete` and updates the freshness date. No code changes.

### Changes Required

#### 1. Fill §6.5 in test-plan.md

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 3` placeholder in §6.5 with the canonical pattern for review integration tests, following the style of §6.2 and §6.4.

**Contract**: §6.5 should document: file location (`src/pages/api/__tests__/study/`), the three-call `makeReviewSupabase({ card?, insertError?, updateError? })` factory pattern, the `makeCtx(body, user?)` helper, direct handler invocation (`const res = await POST(makeCtx(...))`), the RFC 4122 UUID rule, and the non-atomic INSERT-before-UPDATE ordering with the comment convention for R10-style tests.

#### 2. Mark §3 Phase 3 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Phase 3 row status in the §3 rollout table from `implementing` (or current state) to `complete`.

**Contract**: Update the `Status` cell in the `| 3 | SRS integrity + data boundary |` row to `complete`. Update the `Last updated` line in the file header.

---

### Success Criteria

#### Automated Verification

- `npm test` passes (no regressions from doc-only changes)
- `npm run lint` passes

#### Manual Verification

- §6.5 reads clearly — a future contributor can understand the review test pattern without reading the full plan
- §3 Phase 3 row shows `complete`

---

## Critical Implementation Details

**Three-call mock ordering for review.ts.** The SELECT, INSERT, and UPDATE calls all route through the same `createClient()` instance. Vitest re-uses the mock across all three calls. The `fromCallCount` counter must reset per `beforeEach` — failing to reset means tests bleed into each other. Use `beforeEach(() => { vi.clearAllMocks(); ... })`.

**IDOR proof in R4.** The test must use `makeCtx(payload, { id: USER_B_ID })` while `payload.cardId = CARD_ID` (owned by USER_A). The mock SELECT returns `{ data: null, error: { code: "PGRST116" } }` regardless of which user it is called with — this simulates the RLS + app filter blocking User B's access. Assert `from("review_logs")` was never called to prove the 404 short-circuits before INSERT.

**Due endpoint parallel queries.** `Promise.all` in `due.ts:49` fires all three queries before any resolves. Since the mock is synchronous (returns resolved promises), JavaScript processes the calls in creation order (call 1, 2, 3). `fromCallCount` tracking works correctly. Verify the call assignments match the actual call order in `due.ts` during implementation.

**`scheduledFor` in R5.** The response `scheduledFor` is computed as `now + 3 days` (good outcome, `OUTCOME_INTERVAL_DAYS.good = 3`). Since `now` is set inside the handler, the test cannot pin the exact timestamp. Assert that `scheduledFor` is a non-empty string (or that it is a future ISO timestamp) rather than an exact value.

---

## Testing Strategy

### Integration Tests

- R1–R3: auth and input validation boundaries
- R4: IDOR — explicit two-user scenario, INSERT blocked before reaching review_logs
- R5–R8: happy-path and edge cases for the SRS state machine
- R9–R10: error paths documenting the non-atomic INSERT → UPDATE sequence
- D1–D2: auth gate and user-scoped response for the due endpoint

### Manual Testing Steps

1. Run `npm test` — confirm 12 new tests appear (R1–R10 + D1–D2) and all pass
2. Review R4 test name and comment — confirm it explicitly calls out the IDOR scenario
3. Review R10 comment — confirm it names the non-atomic design and the upstream source (`review.ts:74-76`)
4. Read §6.5 in test-plan.md — confirm a new contributor could add a review test from it without reading this plan

## References

- Research: `context/changes/testing-srs-integrity-data-boundary/research.md`
- Review route: `src/pages/api/study/review.ts`
- Due route: `src/pages/api/study/due.ts`
- SRS service: `src/lib/services/srs.ts`
- Interval lookup: `src/lib/study-intervals.ts`
- Phase 1 canonical test: `src/pages/api/__tests__/generate.test.ts`
- Phase 2 mock factory pattern: `src/pages/api/__tests__/save-deck.test.ts:44-95`
- Phase 2 GET helper pattern: `src/pages/api/__tests__/deck-index.test.ts`
- Test plan §6.5: `context/foundation/test-plan.md:212-214`
- Prior lesson (double-submit): `context/foundation/lessons.md:34-38`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: POST /api/study/review integration tests

#### Automated

- [x] 1.1 `npm test` passes — all R1–R10 tests present and green
- [x] 1.2 `npm run lint` passes on `src/pages/api/__tests__/study/review.test.ts`

#### Manual

- [x] 1.3 R4 (IDOR test) explicitly names USER_A / USER_B and includes a comment identifying it as the IDOR proof
- [x] 1.4 R10 carries the non-atomic INSERT comment referencing `review.ts:74-76`

### Phase 2: GET /api/study/due minimal tests

#### Automated

- [ ] 2.1 `npm test` passes — D1–D2 present and green
- [ ] 2.2 `npm run lint` passes on `src/pages/api/__tests__/study/due.test.ts`

#### Manual

- [ ] 2.3 D2 response shape includes `cards`, `total_due`, `total_accepted`, `next_due_at`

### Phase 3: Cookbook update and test-plan status

#### Automated

- [ ] 3.1 `npm test` passes (no regressions)
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 `test-plan.md §6.5` filled in with canonical review test pattern
- [ ] 3.4 `test-plan.md §3` Phase 3 row Status = `complete`
