<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: SRS Review Session

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: All phases (Phase 1, 2, 3)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  5 warnings  5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Concurrent review corruption: TOCTOU on FSRS state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/study/review.ts:41–111
- **Detail**: The review handler is a read-modify-write with no concurrency guard. Two submissions for the same card at the same time (double-tap, two tabs, slow network retry) both read the same FSRS snapshot, compute independent new states, and the last UPDATE wins — silently discarding one review. For an SRS app where scheduling accuracy is the core value this degrades the algorithm's correctness in a way the user cannot see.
- **Fix A ⭐ Recommended**: Add optimistic concurrency to the UPDATE — extend the WHERE clause to require the current `fsrs_reps` matches what was fetched. Return 409 Conflict if row count is 0; client re-fetches and retries.
  - Strength: No schema/RPC changes needed; Supabase JS supports `.eq("fsrs_reps", card.fsrs_reps ?? 0)`.
  - Tradeoff: Client must handle 409 and re-fetch — one extra round trip per conflict.
  - Confidence: HIGH — RLS already scopes to user_id + id; adding one more `.eq()` is trivial.
  - Blind spot: Doesn't solve F3 (INSERT + UPDATE non-atomicity).
- **Fix B**: Extract to a Postgres RPC that atomically applies the pre-computed new state and inserts the log in one transaction.
  - Strength: Eliminates F1 + F2 + F3 simultaneously.
  - Tradeoff: Requires a new migration with a PL/pgSQL function.
  - Confidence: MED — more robust but meaningful migration work.
  - Blind spot: FSRS computation must still happen in TS before calling the RPC.
- **Decision**: PENDING

### F2 — `first_reviewed_at` set with JS `??` instead of SQL COALESCE

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/study/review.ts:94–108
- **Detail**: Plan (plan.md:52 and plan.md:233–234) required `first_reviewed_at = COALESCE(first_reviewed_at, now())` in the SQL UPDATE for atomic single-write semantics. Implementation reads the value at fetch time and sends it as a literal in the UPDATE. In the concurrent race window between fetch and update, a concurrent request can have already set `first_reviewed_at`; this write sends a later `now.toISOString()` and overwrites the earlier one. The S-03 lock still activates but the recorded timestamp may not be the true first review time.
- **Fix**: Applying F1's optimistic concurrency fix (matching `fsrs_reps` in WHERE) largely closes this window simultaneously. Alternatively, pass `first_reviewed_at` only when `card.first_reviewed_at === null`, relying on a conditional update strategy.
  - Strength: If F1 is applied, no additional work needed for F2.
  - Tradeoff: Without F1, requires separate conditional logic or a raw SQL expression.
  - Confidence: HIGH — fixing F1 addresses the root cause of both.
  - Blind spot: None significant if F1 is addressed first.
- **Decision**: PENDING

### F3 — INSERT review_log and UPDATE flashcard are not in a transaction

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/study/review.ts:74–115
- **Detail**: `review_logs` INSERT (line 77) and `flashcards` UPDATE (line 96) are two independent Supabase calls. If INSERT succeeds and UPDATE fails, there is an orphan log row with FSRS state that never landed on the card. A retry creates a second log row. The code comment acknowledges this trade-off but accepts it without mitigation.
- **Fix A ⭐ Recommended**: Add compensating delete — store the inserted row's `id` from the INSERT response (chain `.select("id").single()`), and on UPDATE failure delete the just-inserted log row before returning 500.
  - Strength: Minimal change; eliminates orphan logs without requiring a Postgres function.
  - Tradeoff: The compensating delete can itself fail, leaving one orphan log in a rare double-failure.
  - Confidence: HIGH — Supabase JS returns the inserted row when `.select()` is chained after `.insert()`.
  - Blind spot: Process crash between INSERT and UPDATE is out of scope for a Workers request.
- **Fix B**: Move both operations into a Postgres RPC.
  - Strength: Fully atomic — one transaction, no orphan risk.
  - Tradeoff: Requires a new migration with a PL/pgSQL function.
  - Confidence: MED — more robust but higher effort.
  - Blind spot: FSRS computation must still happen in TS before the RPC.
- **Decision**: PENDING

### F4 — `review_logs` INSERT RLS does not verify `card_id` ownership

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Security)
- **Location**: supabase/migrations/20260610200000_create_review_logs.sql:26–27
- **Detail**: `review_logs_insert_own` is `WITH CHECK (user_id = auth.uid())`. A user accessing Supabase directly with the anon key can insert rows with their own `user_id` but any valid `card_id` — including cards belonging to other users. The API route enforces ownership, but RLS is the last line of defense. This pollutes the audit log with garbage entries for other users' cards.
- **Fix**: Extend `WITH CHECK` to verify card ownership: `WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM flashcards f WHERE f.id = card_id AND f.user_id = auth.uid()))`. Requires a new migration to drop and recreate the policy.
  - Strength: RLS becomes a true ownership boundary, independent of the API layer.
  - Tradeoff: Slightly heavier INSERT policy; adds one subquery per INSERT.
  - Confidence: HIGH — standard defense-in-depth pattern for Supabase RLS.
  - Blind spot: None significant.
- **Decision**: PENDING

### F5 — Phase 3 architecture: SSR branching replaced with client-side fetch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Architecture
- **Location**: src/pages/study.astro, src/components/study/StudySession.tsx
- **Detail**: Plan Phase 3 specified `study.astro` fetches session data server-side and passes `initialCards: StudyCardDTO[], totalDue: number` as props to `<StudySession>`. Actual implementation is a 21-line shell with no frontmatter queries; `StudySession` self-fetches via `useEffect`. Empty states and loading phase live in the React island. The approach is pragmatically consistent with `deck.astro`/`generate.astro` but means users see a loading spinner and the planned "Next review: {timestamp}" in the empty-no-due state is absent (no `MIN(fsrs_due)` query exists anywhere).
- **Fix A ⭐ Recommended**: Accept the drift as intentional — add the missing next-review timestamp by returning `next_due_at: string | null` from `GET /api/study/due` when cards is empty, and rendering it in StudySession's empty-no-due branch.
  - Strength: Minimal change; consistent with the chosen client-side pattern; delivers the missing feature.
  - Tradeoff: SSR benefits (no loading flicker, crawlable empty states) remain absent.
  - Confidence: HIGH — `/api/study/due` already runs the accepted-card query; `MIN(fsrs_due)` is one conditional DB call.
  - Blind spot: `next_due_at` can be null if all accepted cards have `fsrs_due IS NULL`; handle with "Check back later" fallback.
- **Fix B**: Rewrite `study.astro` to do SSR fetching per the original plan, passing props to a prop-accepting `StudySession`.
  - Strength: No loading spinner; plan contract fully honoured; empty states are crawlable SSR HTML.
  - Tradeoff: Significant rewrite diverging from the deck/generate pattern in the rest of the app.
  - Confidence: MED — architecturally cleanest but inconsistent with existing island approach.
  - Blind spot: None significant.
- **Decision**: PENDING

### F6 — `useEffect` in StudySession missing unmount cancellation guard

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/study/StudySession.tsx:47–83
- **Detail**: `DeckManager.tsx` uses `let cancelled = false` + cleanup function to prevent `setState` on unmounted components. `StudySession.useEffect` has no cleanup — fast navigation away triggers a React warning.
- **Fix**: Add `let cancelled = false` guard and `return () => { cancelled = true }` to the useEffect, mirroring DeckManager.tsx:27.
- **Decision**: PENDING

### F7 — All fetchError cases in review.ts return 404

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/study/review.ts:49–52
- **Detail**: `if (fetchError)` returns `json({ error: "Card not found" }, 404)`. `deck/[id].ts` uses `.maybeSingle()` and distinguishes error (→ 500) from absent row (→ 404). A real DB or network error is misreported as 404.
- **Fix**: Switch to `.maybeSingle()`, check `error` → 500, check `!card` → 404, mirroring src/pages/api/deck/[id].ts:40–45.
- **Decision**: PENDING

### F8 — "All caught up" empty state missing next-review timestamp

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/study/StudySession.tsx:157–175
- **Detail**: Plan (plan.md:308–312) specified `SELECT MIN(fsrs_due)` to show the user when their next card is due. Current empty-no-due state renders "Come back later" unconditionally.
- **Fix**: Add `next_due_at: string | null` to `StudyDueResponseDTO` and return `MIN(fsrs_due)` from `GET /api/study/due` when cards is empty. Render "Next review: {formattedDate}" in the island. (Overlaps with F5 Fix A.)
- **Decision**: PENDING

### F9 — `GET /api/study/due` returns full `flashcards` rows, not `StudyCardDTO` subset

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/study/due.ts:25
- **Detail**: `select("*")` returns all flashcard columns including `user_id`, `generation_id`, `status`. `StudyCardDTO` is defined as a Pick but the endpoint leaks the full row.
- **Fix**: Replace `select("*")` with an explicit column list matching `StudyCardDTO` fields.
- **Decision**: PENDING

### F10 — Grade buttons `disabled` when submitting; plan specified `hidden`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/study/StudySession.tsx:265–278
- **Detail**: Plan (plan.md:284): "Four grade buttons visible only when `isFlipped && !isSubmitting`". Implementation renders buttons with `disabled={isSubmitting}` — visible but dimmed. Minor UX difference.
- **Fix**: Wrap grade buttons in `{!isSubmitting && (…)}` or show a spinner in their place while submitting.
- **Decision**: PENDING
