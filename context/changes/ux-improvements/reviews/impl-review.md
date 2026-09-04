<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UX Improvements (S-06)

- **Plan**: `context/changes/ux-improvements/plan.md`
- **Scope**: Full plan (Phases 1–2)
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Session completion treats refresh failure as grade failure

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/study/StudySession.tsx:128-163`
- **Detail**: After the last card’s review POST succeeds, `/api/study/due` is fetched in the same `try`. If that fetch throws, the outer `catch` shows a grade error and leaves the user on the last card with grading UI — but the review is already persisted. A retry can duplicate `review_logs` and corrupt SRS state. Pre-existing in `StudySession`; not introduced by End session/spinner edits, but remains in a file this change touched.
- **Fix**: After a successful review POST, transition to `complete` (or a refresh-failed state) before/alongside the due refresh. Wrap the due fetch in its own `try/catch` so refresh failures never reuse the grade error path.
  - Strength: Matches NFR “SR must not lose or corrupt review history”; prevents double-submit on the last card.
  - Tradeoff: Slightly more state-machine branching in `handleGrade`.
  - Confidence: HIGH — failure mode is clear from control flow.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — No in-flight guard on grade submission

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/study/StudySession.tsx:105-109`
- **Detail**: `handleGrade` does not return early when `session.isSubmitting` is already true. A fast double-click before re-render can fire two review POSTs for the same card. Pre-existing; spinner UI reduces likelihood but does not eliminate the race.
- **Fix**: Add `if (session.isSubmitting) return;` at the top of `handleGrade` (or a synchronous `useRef` lock before `await fetch`).
- **Decision**: ACCEPTED-AS-RULE: Guard async handlers against double submission

### F3 — Curation edit confirm allows whitespace-only content

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/components/generation/CurationPanel.tsx:243-248`
- **Detail**: Edit Confirm saves `displayFront`/`displayBack` without trim or empty validation. `CardModal` trims and rejects blanks; `save-deck.ts` only enforces `min(1)`, so whitespace-only edits can persist. Pre-existing from S-02; bulk/clear buttons did not worsen this.
- **Fix**: Trim on Confirm and block when either side is empty after trim, with inline validation — mirror `CardModal.tsx:23-26`.
- **Decision**: ACCEPTED-AS-RULE: Trim and validate inline edit fields before staging curation saves

### F4 — Unplanned scope additions (documented)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/components/generation/CurationPanel.tsx:83-93`, `src/lib/format-interval.ts`
- **Detail**: **Clear accepted & discarded** toolbar button and calendar-aware `formatRelativeReviewTime` were added during implementation per user feedback; neither appears in the original plan. Both are UI-only, user-validated, and low risk.
- **Fix**: Add a short addendum to `plan.md` or `plan-brief.md` noting these post-plan enhancements.
- **Decision**: FIXED

### F5 — Discard-only save hint not added

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/generation/CurationPanel.tsx` (toolbar area)
- **Detail**: Plan Critical Implementation Details suggested an optional hint (“Accept or edit at least one card to save”) if discard-all-with-zero-accepts confuses users. Not implemented. User did not report confusion during manual verification.
- **Fix**: Add one-line hint below toolbar when `savedCount === 0 && discardedCount > 0`, or skip if UX is acceptable.
- **Decision**: FIXED
