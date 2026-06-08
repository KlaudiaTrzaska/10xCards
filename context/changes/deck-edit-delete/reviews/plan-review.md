<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deck Edit & Delete (S-03)

- **Plan**: `context/changes/deck-edit-delete/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: SOUND (after fixes applied)
- **Findings**: 1 critical | 2 warnings | 1 observation

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL → PASS (after fixes) |

## Grounding

8/8 paths ✓, 4/4 symbols ✓, brief↔plan ✓

Verified: `src/lib/api-utils.ts` exists (181 bytes); `context.params.id` is valid for Astro 6.3.1 on-demand routes; `count: "exact"` supported by `@supabase/postgrest-js` ^2.107.0; Radix Dialog unmounts portal content but NOT parent component (stale useState risk confirmed).

## Findings

### F1 — Progress section missing 2 manual verification checkboxes

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress — Phase 1 and Phase 3 subsections
- **Detail**: Phase 1 Manual Verification had 3 bullets but Progress only tracked 2 (missing "TypeScript build reports no type errors"). Phase 3 Manual Verification had 8 bullets but Progress only tracked 7 (missing "Save error modal shows inline error and stays open"). /10x-implement parses Progress to track implementation state — missing checkboxes means those steps are untrackable.
- **Fix**: Added `- [ ] 1.6 TypeScript build reports no type errors from the new field` and `- [ ] 3.10 Save error modal shows inline error and stays open` to the Progress section.
- **Decision**: FIXED

### F2 — CardModal stale useState when re-opened for a different card

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — DeckManager contract, Render structure
- **Detail**: CardModal initializes `front` and `back` via `useState(card?.front ?? "")`. React's useState initializer runs once on mount. Radix Dialog unmounts portal content on close but NOT the parent CardModal component — if CardModal stayed always-mounted, `front`/`back` state from a prior edit session would persist when the modal opened for a different card.
- **Fix**: Added explicit requirement to the DeckManager Render structure: "CardModal must be conditionally rendered as `{modalState.open && <CardModal ... />}` to ensure `useState` re-initializes with fresh values from the current card on each open."
- **Decision**: FIXED

### F3 — useEffect keyed only on `page` wouldn't re-fetch after same-page create/edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — DeckManager contract, "Data fetch" section
- **Detail**: The plan said "Data fetch: useEffect keyed on `page`" but also "After create/update: re-fetch current page." A useEffect keyed only on `page` does not re-run when page hasn't changed — creates/edits on the current page would require navigation away and back to appear.
- **Fix**: Added `refetchKey: number` to state, changed useEffect dependency array to `[page, refetchKey]`, specified that create/edit/delete success handlers call `setRefetchKey(k => k + 1)`. Also clarified the last-card-on-page delete logic: check `cards.length === 1` before deleting to decide whether to decrement `page` or increment `refetchKey`.
- **Decision**: FIXED

### F4 — DELETE 204 (no body) requires a custom Response, not the json() helper

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Delete card contract
- **Detail**: All established routes use `json()` from `@/lib/api-utils.ts`. The `json()` helper always serializes a body. HTTP 204 must have no body — `json({}, 204)` would be non-compliant.
- **Fix**: Clarified the DELETE success response: "Returns `new Response(null, { status: 204 })` on success — do not use the `json()` helper here, which always attaches a body; HTTP 204 must have no body."
- **Decision**: FIXED
