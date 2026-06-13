# UX Improvements (S-06) Implementation Plan

## Overview

Close the UX gaps identified in roadmap S-06 after the core product loop shipped:
bulk curation shortcuts on `/generate`, a mid-session exit on `/study`, and
consistent loading feedback on the main product async flows. The frame brief
confirmed bulk curation as the critical path; study reset and loading polish
ship in a second phase. All changes are UI-only — `POST /api/save-deck` already
accepts bulk `accepted[]` arrays and requires no backend work.

## Current State Analysis

**Curation (`CurationPanel.tsx`):**
- Per-card Accept / Edit / Discard only; no bulk shortcuts (`CurationPanel.tsx:184-234`)
- `decisions: Map<string, CardDecision>` staged locally; single Save POST (`CurationPanel.tsx:48-62`)
- Heading shows total draft count, not progress (`CurationPanel.tsx:81-83`)
- Save footer at list bottom — S-02 plan specified a sticky footer (`atomic-save-to-deck/plan.md:228`) but it was never implemented

**Study (`StudySession.tsx`):**
- Client-side state machine; reviews persist immediately via `POST /api/study/review` (`StudySession.tsx:105-165`)
- No exit/reset affordance during `studying` phase
- Initial load uses spinner (`StudySession.tsx:169-175`); grade submit shows text only (`StudySession.tsx:277-278`)

**Loading inconsistencies:**
- `GenerateForm.tsx` and `CurationPanel.tsx` — spinner + disabled controls (good pattern)
- `DeckManager.tsx:126` — plain text `"Loading deck…"` with no spinner
- `CardModal.tsx:120` — text `"Saving…"` with no spinner

**API constraint (unchanged):**
- `save-deck.ts:22-24` requires `accepted.length + edited.length > 0` — discard-only commits are impossible (pre-existing S-02 behavior)

## Desired End State

After this plan:

1. User can **Accept all remaining** or **Discard all remaining** undecided draft
   cards in one click, then commit with the existing Save button.
2. Curation panel shows **decision progress** (e.g. "7 of 10 decided") and keeps
   Save accessible via a **sticky footer** while scrolling long batches.
3. User can **end a study session** mid-review and navigate to `/deck`; reviews
   already submitted remain in `review_logs` (no API rollback).
4. Deck load, card save, and study grade-submit show the same **spinner +
   label** pattern as generation/curation.

### Key Discoveries

- Bulk accept is UI-only — server already bulk-updates via `.in("id", accepted)` (`save-deck.ts:64-70`)
- S-02 explicitly deferred bulk shortcuts for the ≥75% acceptance metric (`atomic-save-to-deck/plan-brief.md:28`); S-06 re-opens as speed UX with undecided-only semantics
- Study "reset" is navigation only — reviews are append-only per NFR; no server undo needed

## What We're NOT Doing

- API or DB changes (including discard-only save — preserves S-02/US-01 "at least one accept")
- Confirmation modals for bulk actions (user chose undecided-only without confirm)
- Shared `LoadingSpinner` component extraction (inline spinners per existing pattern)
- Loading-state changes to auth/settings forms (`SubmitButton`, `DeleteAccountForm`)
- Keyboard shortcuts, card-by-card wizard mode, or generation count changes
- Undoing submitted study reviews server-side

## Implementation Approach

Two phases, critical path first:

1. **Bulk curation throughput** — extend `CurationPanel` decision helpers, toolbar,
   progress header, sticky save footer. Reuse existing `setDecision` / `handleSave`.
2. **Study exit + loading polish** — add End session link in `StudySession`;
   align spinner markup in `DeckManager`, `CardModal`, and study grade-submit.

## Critical Implementation Details

**Bulk action scope:** "Undecided" means no entry in `decisions` Map. Bulk
Accept all / Discard all must **skip** cards with any existing decision
(`accepted`, `discarded`, `edited`, or `editing`). Cards mid-edit (`editing`)
must not be overwritten — user finishes or cancels edit first.

**Discard-only save still blocked:** If bulk Discard all remaining leaves
`savedCount === 0`, Save stays disabled (same as today). No API change. If
this becomes confusing in manual testing, add a one-line hint below the toolbar:
"Accept or edit at least one card to save."

**Study end session:** Use `window.location.href = "/deck"` (or `<a href="/deck">`)
from the `studying` phase only. Do not call any API. Reviews already persisted
via `handleGrade` remain in `review_logs`.

## Phase 1: Bulk Curation Throughput

### Overview

Add bulk shortcuts, decision progress, and sticky save footer to `CurationPanel`
without changing the save API contract.

### Changes Required:

#### 1. Bulk decision helpers and toolbar

**File**: `src/components/generation/CurationPanel.tsx`

**Intent**: Let users accept or discard all undecided cards in one action while
preserving per-card decisions already made.

**Contract**:
- Add derived values:
  - `undecidedCards` — `cards` where `decisions.get(id)` is `undefined`
  - `decidedCount` — cards with any decision whose `action !== "editing"` (editing-in-progress does not count as decided for progress)
- Add `acceptAllUndecided()` and `discardAllUndecided()` that batch-update
  `decisions` via `setDecisions` (functional update over a new `Map`):
  - For each card in `undecidedCards`, set `{ action: "accepted" }` or
    `{ action: "discarded" }` respectively
  - Do not modify cards with existing decisions
- Render a toolbar row below the section heading with two secondary buttons:
  - **Accept all remaining** — disabled when `undecidedCards.length === 0` or `isSaving`
  - **Discard all remaining** — same disable rules
- Use `cn()` and existing button styling from per-card action buttons; icons
  optional (`Check`, `X` from lucide-react already imported)

#### 2. Decision progress in heading

**File**: `src/components/generation/CurationPanel.tsx`

**Intent**: Surface how far through the batch the user is, reducing scroll anxiety.

**Contract**:
- Replace static heading (`Review N draft cards`) with progress text:
  `{decidedCount} of {cards.length} decided` as primary line; keep total draft
  count as secondary/subtitle if needed for clarity
- `decidedCount` updates reactively when bulk or per-card actions fire

#### 3. Sticky save footer

**File**: `src/components/generation/CurationPanel.tsx`

**Intent**: Keep Save and error feedback visible while scrolling 10–15 card panels.

**Contract**:
- Move the save footer (`saveError` + Save button block, currently `242-271`)
  into a sticky container: `sticky bottom-0` with backdrop (`bg-slate-900/90`
  or `bg-white/10 backdrop-blur-xl`) and top border matching cosmic theme
- Add bottom padding to the card `<ul>` so the last card is not hidden behind
  the sticky footer
- Preserve existing Save button behavior: disabled when `savedCount === 0 ||
  isSaving`; spinner during save

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Generate 10 cards; click **Accept all remaining** — all undecided cards turn
  green; Save shows "Save 10 cards"; per-card Accept/Discard still work on
  individual cards after bulk
- With 3 accepted manually, click **Discard all remaining** — only the 7
  undecided cards become discarded; Save count stays 3
- Card in edit mode (`editing`): bulk actions do not alter that card until
  Confirm/Cancel
- Progress reads "N of 10 decided" and increments with each action
- Sticky footer remains visible when scrolling a 15-card batch
- Save → `/deck?saved=N` still works; error retry preserves bulk + per-card state

**Implementation Note**: Pause for human manual verification before Phase 2.

---

## Phase 2: Study Exit + Loading State Polish

### Overview

Add mid-session exit on `/study` and align loading feedback on deck, modal, and
study grade-submit with the generation/curation spinner pattern.

### Changes Required:

#### 1. End session control

**File**: `src/components/study/StudySession.tsx`

**Intent**: Let users abandon an in-progress study session without finishing
all due cards; submitted reviews remain persisted.

**Contract**:
- In the `studying` phase render branch only, add a secondary **End session**
  control (text link or outline button) that navigates to `/deck`
- Place it in the progress header row (`229-236` area) or below grade buttons —
  must not compete visually with grade buttons
- Disabled while `isSubmitting === true`
- No API call; no state-machine transition to `complete`

#### 2. Deck loading spinner

**File**: `src/components/deck/DeckManager.tsx`

**Intent**: Match study/generate loading affordance on deck fetch.

**Contract**:
- Replace plain `"Loading deck…"` text (`~126`) with centered spinner +
  label using the same markup as `StudySession.tsx:171-173`:
  `h-6 w-6 animate-spin rounded-full border-2 border-purple-400 border-t-transparent`

#### 3. Card modal save spinner

**File**: `src/components/deck/CardModal.tsx`

**Intent**: Show visual activity during card create/edit save.

**Contract**:
- When `isSaving`, render submit button content as flex row with inline spinner
  (`size-4 animate-spin rounded-full border-2 border-white/30 border-t-white`)
  + `"Saving…"` — mirror `GenerateForm.tsx:132-136`

#### 4. Study grade-submit spinner

**File**: `src/components/study/StudySession.tsx`

**Intent**: Replace text-only "Saving review…" with spinner + label during
`isSubmitting`.

**Contract**:
- Replace `StudySession.tsx:277-278` text block with spinner markup consistent
  with deck/generate pattern (centered, `py-3`)

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Start study session, review 2 cards, click **End session** — lands on `/deck`;
  reload `/study` — reviewed cards no longer appear in current batch (FSRS schedule updated)
- Deck page shows spinner (not plain text) while fetching
- Card create/edit modal shows spinner on Save click until response
- Grade button click shows spinner until review POST completes
- No regressions on empty-no-cards, empty-no-due, complete, or error phases

**Implementation Note**: Pause for human manual verification after Phase 2.

---

## Testing Strategy

### Unit Tests:

- None planned (consistent with S-02/S-04 — no component test runner in CI)

### Integration Tests:

- None planned

### Manual Testing Steps:

1. Full curation flow: generate 15 cards → Accept all remaining → Save → deck banner
2. Mixed curation: accept 2, discard all remaining 8, leave 5 undecided → Save 2
3. Edit interruption: open edit on one card → Accept all remaining → edited card unchanged
4. Study exit: review 3 cards → End session → verify deck → return to study
5. Loading visuals: throttle network in DevTools on deck load, card save, grade submit

## Performance Considerations

No performance impact. Bulk actions update a `Map` in React state (max 15 entries).
Sticky footer is CSS-only. No additional API calls.

## Migration Notes

No DB migration. No env changes.

## References

- Frame brief: `context/changes/ux-improvements/frame.md`
- Roadmap S-06: `context/foundation/roadmap.md`
- S-02 curation baseline: `context/changes/atomic-save-to-deck/plan.md`
- Curation UI: `src/components/generation/CurationPanel.tsx`
- Save API: `src/pages/api/save-deck.ts`
- Study session: `src/components/study/StudySession.tsx`
- Deck manager: `src/components/deck/DeckManager.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bulk Curation Throughput

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 84e9c9c
- [x] 1.2 Build passes: `npm run build` — 84e9c9c

#### Manual

- [x] 1.3 Accept all remaining accepts only undecided cards; Save count correct — 84e9c9c
- [x] 1.4 Discard all remaining discards only undecided cards; prior decisions preserved — 84e9c9c
- [x] 1.5 Cards in edit mode unaffected by bulk actions — 84e9c9c
- [x] 1.6 Progress indicator and sticky footer work on 15-card batch — 84e9c9c
- [x] 1.7 Save, error retry, and navigation to `/deck?saved=N` unchanged — 84e9c9c

### Phase 2: Study Exit + Loading State Polish

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 3960b7a
- [x] 2.2 Build passes: `npm run build` — 3960b7a

#### Manual

- [x] 2.3 End session navigates to `/deck`; prior reviews persisted — 3960b7a
- [x] 2.4 DeckManager shows spinner while loading — 3960b7a
- [x] 2.5 CardModal shows spinner while saving — 3960b7a
- [x] 2.6 StudySession shows spinner while submitting grade — 3960b7a
- [x] 2.7 Study empty/error/complete phases unaffected — 3960b7a
