---
date: 2026-06-21T18:15:00+02:00
researcher: AI (Sonnet 4.6)
git_commit: 519c72a5dc5383ef5002fd9661fda7b33eaad3f9
branch: cursor/add-test-plan
repository: KlaudiaTrzaska/10xCards
topic: "SRS integrity and cross-user data boundary — Phase 3 test plan grounding"
tags: [research, testing, srs, review, fsrs, rls, idor, phase-3]
status: complete
last_updated: 2026-06-21
last_updated_by: AI (Sonnet 4.6)
---

# Research: SRS Integrity and Cross-User Data Boundary (Phase 3)

**Date**: 2026-06-21T18:15:00+02:00
**Researcher**: AI (Sonnet 4.6)
**Git Commit**: `519c72a5dc5383ef5002fd9661fda7b33eaad3f9`
**Branch**: `cursor/add-test-plan`
**Repository**: KlaudiaTrzaska/10xCards

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`. For Risk #3 (SRS integrity — review history consistency) and Risk #4 (cross-user data boundary — IDOR / RLS gap): trace the real failure paths in code, verify the response guidance from the test plan, locate existing tests, and identify the cheapest useful test layer.

---

## Summary

**Risk #3 — SRS integrity.** The review API is two non-atomic Supabase calls: INSERT `review_logs` first, then UPDATE `flashcards` FSRS columns. `review_logs` is DB-enforced append-only (no UPDATE/DELETE RLS policies; `Update: Record<never, never>` TypeScript type). The scheduling logic is a **custom lookup table** in `src/lib/services/srs.ts` — ts-fsrs is imported only for `Rating` and `State` constants. A known double-submit gap exists in `StudySession.tsx` (React state, not synchronous useRef guard), but that is a UI concern; the API has no idempotency key. **Zero integration tests** exist for `POST /api/study/review` or `GET /api/study/due`.

**Risk #4 — Cross-user IDOR.** All tables have RLS enforced with `user_id = auth.uid()` policies. The Supabase client is user-scoped (anon key + JWT session cookies, not service role). Every study/review/deck API endpoint additionally applies `.eq("user_id", user.id)` at the app layer. The IDOR surface: User B submitting a review with User A's `cardId` hits the SELECT guard (`.eq("user_id", user.id).single()`) and gets 404 — the real card never returns. **Zero integration tests** for cross-user denial on study/review routes. The Phase 2 deck CRUD tests also covered the deck IDOR surface.

**Test plan challenge validation.** The plan's "Must challenge: 'ts-fsrs handles it'" is confirmed correct — the scheduling is custom, not ts-fsrs. The plan's "Must challenge: 'RLS exists so we're fine'" is also correct — app-level checks exist and should be tested independently.

**Cheapest test layer.** Integration tests in `src/pages/api/__tests__/` following the Phase 1/2 pattern: `vi.mock("@/lib/supabase")`, direct handler invocation, inspect `res.status` + `await res.json()`. No new infrastructure needed.

---

## Detailed Findings

### 1. SRS Service — `src/lib/services/srs.ts`

**CRITICAL CORRECTION to test plan framing.** The test plan source notes "ts-fsrs handles it" as the assumption to challenge. This is confirmed correct — but the reason is specific:

`src/lib/services/srs.ts:1` imports `Rating` and `State` from `ts-fsrs` **only for constants** (e.g., `State.New = 0`, `State.Review = 3`, `Rating.Again = 1`). The actual scheduling algorithm is `buildScheduledReview()` (lines 69–103), a **custom function** using a fixed lookup table:

```ts
// src/lib/services/srs.ts:74
const scheduledDays = OUTCOME_INTERVAL_DAYS[outcome];
// again → 1d, hard → 2d, good → 3d, easy → 5d (from study-intervals.ts:4-9)
const due = addCalendarDays(now, scheduledDays);
```

The function never calls `ts-fsrs`'s `createEmptyCard()`, `fsrs()`, or `next()`. The stability field is `Math.max(previousStability, scheduledDays)` — also custom. The `ts-fsrs` dependency provides naming constants only.

**Consequence for tests:**
- Tests must NOT assert by re-running ts-fsrs algorithm. They should assert the observable behavior from the fixed lookup table (e.g., `again` → `fsrs_scheduled_days: 1`, `fsrs_reps` increments by 1).
- "ts-fsrs handles it" is wrong in both directions: ts-fsrs doesn't run the algorithm, and the custom algorithm doesn't validate against ts-fsrs expectations.

**The full scheduling output shape** for `scheduleReview(currentFields, outcome, now)`:

```ts
// newCardFields written to flashcards:
{
  fsrs_due: addCalendarDays(now, scheduledDays).toISOString(),
  fsrs_stability: Math.max(previousStability ?? scheduledDays, scheduledDays),
  fsrs_difficulty: previousDifficulty ?? 5,
  fsrs_scheduled_days: scheduledDays,          // 1/2/3/5
  fsrs_learning_steps: 0,
  fsrs_reps: (previousReps ?? 0) + 1,
  fsrs_lapses: outcome === "again" ? (previousLapses ?? 0) + 1 : (previousLapses ?? 0),
  fsrs_state: State.Review,                    // 3
  fsrs_last_review: now.toISOString(),
}
// reviewLogFields inserted into review_logs:
{
  rating: Rating[outcome],                     // again=1, hard=2, good=3, easy=4
  state: currentFields?.fsrs_state ?? State.New,  // pre-review state
  stability, difficulty, scheduled_days, reviewed_at
}
```

**Code references:**
- `src/lib/services/srs.ts:1` — ts-fsrs import (constants only)
- `src/lib/services/srs.ts:69-103` — `buildScheduledReview` (custom algorithm)
- `src/lib/study-intervals.ts:4-9` — `OUTCOME_INTERVAL_DAYS` lookup table

---

### 2. Review API — `src/pages/api/study/review.ts`

**Route:** `POST /api/study/review`
**Auth:** `context.locals.user` — returns 401 if missing (line 17-20).

**Ownership-scoped fetch** (lines 42–48):
```ts
const { data: card, error: fetchError } = await supabase
  .from("flashcards")
  .select("*")
  .eq("id", cardId)
  .eq("user_id", user.id)      // ← app-level ownership check
  .eq("status", "accepted")    // ← only accepted cards are reviewable
  .single();
// returns 404 if card not found, not owned, or not accepted
```

**Two non-atomic DB operations** (lines 77–115):

| Step | Operation | Table | Fail behavior |
|------|-----------|-------|---------------|
| 1 | INSERT | `review_logs` | 500 returned; UPDATE never runs |
| 2 | UPDATE | `flashcards` FSRS columns | 500 returned; INSERT already committed |

Comment in code (lines 74–76):
> "INSERT review log first — if this succeeds but the card UPDATE fails, the user will re-grade and a second log is created (acceptable for MVP). This order ensures no review is silently lost."

**`first_reviewed_at` COALESCE** (line 94): `card.first_reviewed_at ?? now.toISOString()` — preserves the original first-review timestamp on re-grading. This is the value that locks the card for edit/delete in `deck/[id].ts`.

**No idempotency key.** Two concurrent POSTs for the same `cardId` both succeed at the API level — both insert a `review_logs` row. The only client-side protection is `isSubmitting` in React state (no synchronous useRef guard per `lessons.md:34-38`).

**Code references:**
- `src/pages/api/study/review.ts:16-122` — full route
- `src/pages/api/study/review.ts:42-48` — ownership SELECT
- `src/pages/api/study/review.ts:74-86` — INSERT review_logs
- `src/pages/api/study/review.ts:96-111` — UPDATE flashcards FSRS columns
- `src/pages/api/study/review.ts:94` — first_reviewed_at COALESCE

---

### 3. Due Cards API — `src/pages/api/study/due.ts`

**Route:** `GET /api/study/due`

All three parallel queries scope by `.eq("user_id", user.id)` (lines 50-62). Returns `StudyDueResponseDTO`: `cards`, `total_due`, `total_accepted`, `next_due_at`. The due-card query: `status = 'accepted' AND (fsrs_due IS NULL OR fsrs_due <= NOW())` — null-fsrs_due cards (never reviewed) come first.

**IDOR surface:** User B calling `GET /api/study/due` gets only their own due cards. No cross-user risk at this endpoint beyond the auth check.

---

### 4. `review_logs` Table — Append-Only Semantics

**Migration:** `supabase/migrations/20260610200000_create_review_logs.sql`

```sql
CREATE TABLE review_logs (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id        uuid  NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state          smallint NOT NULL CHECK (state BETWEEN 0 AND 3),
  stability      real NOT NULL,
  difficulty     real NOT NULL,
  scheduled_days real NOT NULL,
  reviewed_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS: SELECT and INSERT only. No UPDATE or DELETE policies.
CREATE POLICY review_logs_select_own ON review_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY review_logs_insert_own ON review_logs FOR INSERT WITH CHECK (user_id = auth.uid());
```

**TypeScript type** (`src/types.ts:266`): `Update: Record<never, never>` — Supabase client enforces append-only at the type level too.

**Cascade rules:** `ON DELETE CASCADE` on both `user_id` and `card_id`. Card deletion is blocked once `first_reviewed_at IS NOT NULL` (from `deck/[id].ts` lock check) — so in practice, any card with logs cannot be deleted.

---

### 5. RLS Coverage Across All Tables

**Supabase client type** (`src/lib/supabase.ts`): Uses anon key (`SUPABASE_KEY`) + user's JWT session via `parseCookieHeader`. This is a user-scoped client — RLS is enforced on every query. Not a service role client.

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|--------|--------|--------|--------|-------|
| `flashcards` | `user_id = auth.uid()` | `user_id = auth.uid()` + generation ownership | `user_id = auth.uid()` + generation ownership | `user_id = auth.uid()` | Enforced at all 4 operations |
| `generations` | `user_id = auth.uid()` | `user_id = auth.uid()` | — | — | No UPDATE/DELETE policies |
| `review_logs` | `user_id = auth.uid()` | `user_id = auth.uid()` | **none** | **none** | Append-only by design |

**No gaps** found in the RLS policies for the study/review surface. App-level `.eq("user_id", user.id)` adds defense-in-depth on top of RLS.

---

### 6. IDOR Analysis — `POST /api/study/review`

Scenario: User B (id=`u-B`) POSTs `{ cardId: <User A's card ID>, outcome: "good" }`.

1. Middleware resolves `context.locals.user = User B`
2. Route: `supabase.from("flashcards").select("*").eq("id", cardId).eq("user_id", "u-B").eq("status", "accepted").single()`
3. SELECT returns 0 rows (card belongs to User A, and RLS also filters to `auth.uid() = u-B`)
4. `fetchError` is set → `return json({ error: "Card not found" }, 404)`
5. INSERT and UPDATE are never reached

**Result:** 404. No data leakage, no unauthorized mutation.

**What the integration test must mock:**
- `createClient` returns a mock Supabase
- Mock SELECT chain returns `{ data: null, error: { code: "PGRST116" } }` (not found)
- Assert `res.status === 404`, no INSERT call on `review_logs`

---

### 7. Double-Submit Gap — StudySession.tsx

**Lesson reference:** `lessons.md:34-38` — "Guard async handlers against double submission."

**Gap location** (`src/components/study/StudySession.tsx:105-109`):
```ts
async function handleGrade(outcome: ReviewOutcome) {
  if (session.phase !== "studying") return;   // ← guards phase, not isSubmitting
  const card = session.cards[session.currentIndex];
  setSession({ ...session, isSubmitting: true, lastError: null });
  // setSession is async — re-render hasn't fired yet
  // a second click before re-render sees session.isSubmitting === false
```

The grade buttons visually hide when `isSubmitting` is true (line 298), but two synchronous clicks within the same render cycle both pass the phase check and both fire the POST.

**Scope for Phase 3 tests:** This gap is a **UI-layer concern**. Phase 3 targets API route integration tests only (per test plan §7 and Phase 1/2 precedent). The fix (adding `if (session.isSubmitting) return;` or a `useRef` lock at line 106) is not in scope. However, the API tests should document the duplicate-review behavior: two POSTs for the same card succeed independently — the second log is a duplicate, not an error. Tests should assert the happy path (single submission) without assuming idempotency.

---

### 8. Existing Test Coverage

| File | Tests | Study/review coverage |
|------|-------|----------------------|
| `src/lib/services/__tests__/generation.test.ts` | U1–U11 | None |
| `src/pages/api/__tests__/generate.test.ts` | I1–I6 | None |
| `src/pages/api/__tests__/save-deck.test.ts` | S1–S9 | None |
| `src/pages/api/__tests__/deck-index.test.ts` | D1–D8 | None |
| `src/pages/api/__tests__/deck-id.test.ts` | E1–E12 | None |

**Zero tests** for `POST /api/study/review`, `GET /api/study/due`, or any cross-user access denial on these routes.

**No `src/pages/api/__tests__/study/` directory** exists.

---

### 9. Test Patterns Inherited from Phase 1/2

From `context/archive/2026-06-20-testing-bootstrap-generation-resilience/` and `context/changes/testing-generation-deck-flow/`:

**Mock setup (module-scoped, hoisted by Vitest):**
```ts
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
```

**`makeCtx` helper for POST routes:**
```ts
function makeCtx(body: unknown, user: { id: string } | null = { id: "u-1" }) {
  return {
    request: new Request("http://localhost/api/study/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}
```

**Mock factory for multi-step routes** (`save-deck.ts` precedent): track `fromCallCount` to route SELECT → INSERT → UPDATE calls to the right mock data.

**UUID constants:** Use RFC 4122-compliant UUIDs — version nibble in `[1-8]`, variant nibble in `[89abAB]` (e.g., `"00000000-0000-4000-a000-000000000001"`). Zod v4 rejects non-standard UUIDs.

**Direct handler invocation:**
```ts
const res = await POST(makeCtx({ cardId: CARD_ID, outcome: "good" }));
expect(res.status).toBe(200);
const body = (await res.json()) as { scheduledFor: string; outcome: string; error?: string };
```

**Test file locations:** `src/pages/api/__tests__/study/` (new directory needed under `__tests__/`).

---

### 10. Mock Strategy for `POST /api/study/review`

The route makes **three sequential Supabase calls** via the same `createClient` instance:

| Call | Operation | Table | Returns on success |
|------|-----------|-------|--------------------|
| 1 | `.from("flashcards").select("*").eq(...).single()` | `flashcards` | `{ data: card, error: null }` |
| 2 | `.from("review_logs").insert({...})` | `review_logs` | `{ error: null }` |
| 3 | `.from("flashcards").update({...}).eq(...).eq(...)` | `flashcards` | `{ error: null }` |

Factory pattern (following `makeSaveDeckSupabase` precedent):

```ts
function makeReviewSupabase({
  card = MOCK_CARD,          // null → 404
  insertError = null,        // review_logs insert fails
  updateError = null,        // flashcards update fails
}: {
  card?: typeof MOCK_CARD | null;
  insertError?: Error | null;
  updateError?: Error | null;
} = {}) {
  let callCount = 0;
  const from = vi.fn().mockImplementation((table: string) => {
    callCount++;
    if (callCount === 1 && table === "flashcards") {
      // SELECT card
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({
        data: card, error: card ? null : { code: "PGRST116" }
      })})})}) }) };
    }
    if (callCount === 2 && table === "review_logs") {
      // INSERT review_log
      return { insert: () => Promise.resolve({ error: insertError }) };
    }
    // callCount === 3: UPDATE flashcards
    return { update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: updateError }) }) }) };
  });
  return { from };
}
```

Note: the exact chain depth should be verified against the handler source at test time. The pattern above is indicative.

---

## Code References

- `src/pages/api/study/review.ts:1-127` — full review route
- `src/pages/api/study/review.ts:42-48` — ownership-scoped SELECT (IDOR defense)
- `src/pages/api/study/review.ts:74-76` — comment documenting non-atomic INSERT-first design
- `src/pages/api/study/review.ts:77-86` — `review_logs` INSERT
- `src/pages/api/study/review.ts:96-111` — `flashcards` FSRS UPDATE
- `src/pages/api/study/review.ts:94` — `first_reviewed_at` COALESCE (preserves original)
- `src/pages/api/study/due.ts:36-87` — due-cards GET, all queries scoped by `user_id`
- `src/lib/services/srs.ts:1` — ts-fsrs import (constants only)
- `src/lib/services/srs.ts:69-103` — `buildScheduledReview` (custom scheduler)
- `src/lib/study-intervals.ts:4-9` — `OUTCOME_INTERVAL_DAYS` lookup table
- `src/components/study/StudySession.tsx:105-109` — double-submit gap (UI layer)
- `supabase/migrations/20260610200000_create_review_logs.sql:1-29` — append-only table + RLS
- `supabase/migrations/20260606000000_create_flashcards.sql:33-49` — flashcards RLS policies
- `supabase/migrations/20260610000000_enforce_flashcard_generation_ownership.sql:1-33` — tightened INSERT/UPDATE policies
- `src/lib/supabase.ts:6-25` — user-scoped client (anon key + JWT)
- `src/types.ts:266` — `Update: Record<never, never>` on review_logs (append-only type)

---

## Architecture Insights

**Scheduling is custom, not ts-fsrs.** The OUTCOME_INTERVAL_DAYS lookup (1/2/3/5 days) drives all scheduling. ts-fsrs provides only `Rating` and `State` enums. Any test asserting scheduling outcomes must derive expected values from this table, not from the ts-fsrs library behavior.

**Non-atomic review.** INSERT review_log → UPDATE flashcard FSRS has no transaction. The code deliberately chooses INSERT-first so no review is ever silently lost. A duplicate log (from retry after UPDATE failure, or from double-submit) is the accepted failure mode for MVP. Tests should document this behavior with a comment rather than asserting atomicity.

**Defense-in-depth on ownership.** App-level `.eq("user_id", user.id)` exists on every SELECT and UPDATE, independent of RLS. Both layers must be present for safety; the integration tests exercise the app-level check (since the mocked Supabase doesn't enforce RLS). The RLS layer is proven by the migration SQL.

**`first_reviewed_at` as the lock key.** Once a card has been reviewed once, `first_reviewed_at` is set and preserved forever. This value controls the lock in `PATCH/DELETE /api/deck/[id]`. Integration tests should verify the COALESCE behavior: reviewing an already-reviewed card must not overwrite `first_reviewed_at`.

**No study-route test directory.** Phase 3 must create `src/pages/api/__tests__/study/` (or place files directly in `src/pages/api/__tests__/` as sibling to the existing test files — check project convention; existing files are all flat in `__tests__/`).

---

## Test Plan Corrections (Post-Research Backport Candidates)

The following findings should be reviewed against `context/foundation/test-plan.md §2` for possible backport:

1. **Risk #3 source correction.** §2 Source column cites hot-spot evidence only. Research adds a stronger precision: the scheduling is a **custom lookup function**, not ts-fsrs. The "Must challenge: 'ts-fsrs handles it'" is validated — the challenge is correct. No anchor-level correction needed.

2. **Response guidance correction — Risk #3 cheapest layer.** The plan says "integration (+ DB fixture)". Research confirms: integration tests with mocked Supabase (no real DB fixture needed) are sufficient to prove review log insertion, FSRS column update, and non-atomic behavior. Real DB fixture is not needed for the integration test tier. The cheapest layer remains "integration" but the "DB fixture" qualifier can be dropped.

3. **IDOR proof scope — Risk #4.** The plan says "integration (two-user fixtures)." Research confirms two-user is achievable without a real DB: mock the `createClient` to return null from the ownership-scoped SELECT (simulating a card not belonging to user B). No real second-user fixture needed for the API integration test. The "two-user fixtures" qualifier means mock-level fixture with two different user IDs — this is accurate.

---

## Historical Context

- `context/archive/2026-06-20-testing-bootstrap-generation-resilience/plan.md` — Phase 1: Vitest config, `makeCtx` helper, `vi.mock("@/lib/supabase")` pattern established. Phase 3 inherits directly.
- `context/changes/testing-generation-deck-flow/research.md` — Phase 2: `makeSaveDeckSupabase` multi-call mock factory pattern; three-call Supabase mock tracking `fromCallCount`.
- `context/changes/testing-generation-deck-flow/plan.md` — Phase 2: confirms API-route-only scope (no React component tests).
- `context/foundation/lessons.md:34-38` — Double-submit gap in `StudySession.tsx:105-109` (UI layer, out of scope for Phase 3 API tests).

---

## Open Questions

1. **Test file placement.** Existing test files are flat in `src/pages/api/__tests__/`. The review and due routes live in `src/pages/api/study/`. Should Phase 3 create `src/pages/api/__tests__/study/review.test.ts` (mirror directory structure) or `src/pages/api/__tests__/review.test.ts` (flat, matching existing convention)? Recommend flat for consistency, but the plan should decide.

2. **Duplicate review log behavior.** Should Phase 3 include a test that documents the two-POST behavior (two logs created, no error)? This would prove the non-atomic design decision is known and intentional. It is low-value for regression protection but high-value for documentation. Recommend a single test with an explicit comment rather than omitting it.

3. **`GET /api/study/due` coverage.** The due route is simpler (single SELECT with user scoping) and has zero tests. Should Phase 3 add at minimum an auth test (401 when no user) and a happy-path test? Cost is low; signal for IDOR is moderate.

4. **Double-submit fix.** The known gap in `StudySession.tsx` (lessons.md:34-38) is out of scope for Phase 3 API tests. Should a separate change be opened to add the `useRef` synchronous guard? It is a UI fix, not a test, so it would not be a Phase 3 sub-phase but a follow-on change.
