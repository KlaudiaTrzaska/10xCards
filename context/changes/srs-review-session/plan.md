# SRS Review Session Implementation Plan

## Overview

Implement S-04: a stateless study session that serves accepted flashcards ordered by FSRS due date, lets users grade each card (Again / Hard / Good / Easy), and persists review outcomes with full scheduling state using **ts-fsrs**. Review history is append-only. The existing `first_reviewed_at` lock from S-03 is activated atomically on each card's first grade.

## Current State Analysis

S-01 through S-03 are fully implemented. The `flashcards` table has `status = 'accepted'` cards ready as the study pool and a `first_reviewed_at` column (added in the S-03 migration) that enforces the edit/delete lock but is currently never written. No SRS library is installed; no study routes or UI exist.

**Established patterns to follow:**
- API routes: `export const prerender = false`, uppercase method exports, Zod validation, `context.locals.user` from middleware, `json()` helper from `src/lib/api-utils.ts`, `{ error: string }` response shape
- Service layer: thin pure-JS modules in `src/lib/services/` (pattern: `generation.ts`)
- Migrations: `YYYYMMDDHHmmss_description.sql`, RLS enabled, per-operation policies scoped to `user_id = auth.uid()`
- Types: shared in `src/types.ts`; `Database` type is hand-written (not generated)
- UI: Astro SSR page shell + React island (`client:load`)

### Key Discoveries

- `src/types.ts:12–21` — `Flashcard` interface; needs 9 FSRS nullable fields added
- `src/types.ts:74–142` — hand-written `Database` type; needs `review_logs` table + FSRS columns on `flashcards`
- `supabase/migrations/20260608000000_add_first_reviewed_at.sql` — `first_reviewed_at` column exists, never written; S-04 writes it
- `src/pages/api/deck/[id].ts:48–50` — lock check (`first_reviewed_at IS NOT NULL → 403`); becomes active after first grade
- `src/lib/services/generation.ts` — reference pattern for a Workers-compatible pure-JS service
- ts-fsrs `Card` fields (current, non-deprecated): `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`

## Desired End State

Users land on `/study` and see a flip-then-grade session of up to 20 due (or new) flashcards. Grading each card writes the updated FSRS scheduling state to `flashcards` and appends an immutable row to `review_logs`. After the last card is graded, an inline summary appears (grade breakdown + "Back to Deck" button). If no accepted cards exist, or none are due, distinct empty-state messages guide the user. The first grade on any card also sets `first_reviewed_at`, activating the S-03 edit/delete lock.

## What We're NOT Doing

- No `review_sessions` table — each grade is an independent `POST /api/study/review` call; no server-side session lifecycle
- No session resume / localStorage persistence — fresh card load on every visit to `/study`
- No configurable session size — always up to 20 cards per session
- No user-configurable FSRS parameters — ts-fsrs defaults throughout
- No analytics dashboard or session history page
- No export to Anki (PRD non-goal for v1)
- No custom scheduler — FSRS via ts-fsrs is the algorithm; no SM-2 fallback

## Implementation Approach

Three sequential phases so each layer compiles and verifies independently before the next depends on it:

1. **Schema & types first** — FSRS columns on `flashcards`, `review_logs` table, `ts-fsrs` installed, all type definitions updated
2. **Service + API second** — `srs.ts` wraps ts-fsrs; two new routes handle session card fetching and review submission
3. **UI + navigation last** — React island for flip/grade/summary, SSR page shell, three entry points updated

## Critical Implementation Details

- **FSRS initial state for new cards**: a flashcard with all `fsrs_*` columns NULL has never been reviewed. Use `createEmptyCard()` from ts-fsrs as the starting `Card` when `fsrs_state IS NULL`. Never attempt to rehydrate a `Card` from NULL column values.
- **Atomic `first_reviewed_at` write**: the `UPDATE flashcards` in the review handler must use `first_reviewed_at = COALESCE(first_reviewed_at, now())` so it is set only on the first review — in the same statement that writes FSRS scheduling columns. This is the only write ever made to `first_reviewed_at`.
- **Due card query ordering**: `ORDER BY fsrs_due ASC NULLS FIRST LIMIT 20` — new (unstudied, `fsrs_due IS NULL`) cards appear before due cards; among due cards, most overdue appears first.
- **`elapsed_days` is deprecated**: ts-fsrs marks `elapsed_days` as removed in v6.0.0. Do not add it as a column or field anywhere in this plan.

---

## Phase 1: Database, Package, and Types

### Overview

Installs ts-fsrs, adds FSRS scheduling columns to `flashcards`, creates the `review_logs` table with RLS, and updates all type definitions. No routing or UI changes. After this phase the app compiles cleanly with the new schema and types; no runtime behaviour changes yet.

### Changes Required

#### 1. Install ts-fsrs

**File**: `package.json` (via `npm install ts-fsrs`)

**Intent**: Add ts-fsrs as a production runtime dependency. It is a pure ESM/CJS package with no native Node.js addons — confirmed Workers-compatible.

**Contract**: Run `npm install ts-fsrs`. The package lands in `dependencies` in `package.json` and `package-lock.json`.

---

#### 2. FSRS columns migration

**File**: `supabase/migrations/20260610100000_add_fsrs_columns_to_flashcards.sql`

**Intent**: Add nullable FSRS scheduling columns to `flashcards` so existing rows remain valid (NULL = never reviewed, treated as a new card). Also add a partial index to keep the due-card query fast.

**Contract**: `ALTER TABLE flashcards ADD COLUMN` for each of:

| Column | Type | Notes |
|---|---|---|
| `fsrs_due` | `timestamptz` | Next due date; NULL = new card |
| `fsrs_stability` | `real` | Memory stability |
| `fsrs_difficulty` | `real` | Difficulty (1–10) |
| `fsrs_scheduled_days` | `real` | Current interval in days |
| `fsrs_learning_steps` | `integer` | Current (re)learning step |
| `fsrs_reps` | `smallint` | Total review count |
| `fsrs_lapses` | `smallint` | Total lapse count |
| `fsrs_state` | `smallint` | 0=New, 1=Learning, 2=Review, 3=Relearning |
| `fsrs_last_review` | `timestamptz` | Timestamp of last review |

Add partial index:

```sql
CREATE INDEX ON flashcards (user_id, fsrs_due) WHERE status = 'accepted';
```

---

#### 3. review_logs migration

**File**: `supabase/migrations/20260610200000_create_review_logs.sql`

**Intent**: Create an append-only audit table for every review outcome. No UPDATE or DELETE RLS policies — history is immutable by design. Both FK cascades are safe: user deletion removes all their data; card deletion can only happen before first review (S-03 lock), so `review_logs` will always be empty for a deletable card.

**Contract**: Table definition:

| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL` | FK → `auth.users(id)` ON DELETE CASCADE |
| `card_id` | `uuid NOT NULL` | FK → `flashcards(id)` ON DELETE CASCADE |
| `rating` | `smallint NOT NULL` | CHECK `rating BETWEEN 1 AND 4` |
| `state` | `smallint NOT NULL` | CHECK `state BETWEEN 0 AND 3` (pre-review state) |
| `stability` | `real NOT NULL` | FSRS stability at review time |
| `difficulty` | `real NOT NULL` | FSRS difficulty at review time |
| `scheduled_days` | `real NOT NULL` | Interval assigned by this review |
| `reviewed_at` | `timestamptz NOT NULL` | DEFAULT `now()` |

RLS: enabled; policies:
- `review_logs_select_own` — SELECT, `USING (user_id = auth.uid())`
- `review_logs_insert_own` — INSERT, `WITH CHECK (user_id = auth.uid())`

No UPDATE or DELETE policies (append-only enforcement).

Index: `CREATE INDEX ON review_logs (user_id, card_id)`.

---

#### 4. Update `src/types.ts`

**File**: `src/types.ts`

**Intent**: Extend the `Flashcard` interface with nullable FSRS fields; add `ReviewOutcome`, `ReviewLog`, all study DTOs, and the `review_logs` table to the hand-written `Database` type.

**Contract**:

- `Flashcard` interface: add 9 nullable fields matching migration columns (`fsrs_due: string | null`, `fsrs_stability: number | null`, `fsrs_difficulty: number | null`, `fsrs_scheduled_days: number | null`, `fsrs_learning_steps: number | null`, `fsrs_reps: number | null`, `fsrs_lapses: number | null`, `fsrs_state: number | null`, `fsrs_last_review: string | null`). Supabase returns timestamps as ISO strings.
- New type: `ReviewOutcome = "again" | "hard" | "good" | "easy"`
- New interface `ReviewLog`: all `review_logs` columns with TypeScript types mirroring the DB schema
- New DTOs:
  - `StudyCardDTO` — `Pick<Flashcard, "id" | "front" | "back" | "first_reviewed_at" | "fsrs_due" | "fsrs_stability" | "fsrs_difficulty" | "fsrs_scheduled_days" | "fsrs_learning_steps" | "fsrs_reps" | "fsrs_lapses" | "fsrs_state" | "fsrs_last_review">`
  - `StudyDueResponseDTO { cards: StudyCardDTO[]; total_due: number }`
  - `SubmitReviewRequestDTO { cardId: string; outcome: ReviewOutcome }`
  - `SubmitReviewResponseDTO { scheduledFor: string; outcome: ReviewOutcome }`
- `Database` type: extend `flashcards` Row/Insert/Update with FSRS fields; add a `review_logs` entry with Row (all columns) and Insert (omit `id`, `reviewed_at`) types

### Success Criteria

#### Automated Verification

- `npm install ts-fsrs` completes, package appears in `package.json` `dependencies`
- `npm run build` passes (no TypeScript errors on new types or import of ts-fsrs)
- `npm run lint` passes

#### Manual Verification

- Both new migration files exist in `supabase/migrations/` with correct timestamp-prefixed names
- After `supabase db push` (via Supabase CLI against the remote instance — no local Postgres required): FSRS columns visible on `flashcards` in Supabase dashboard; `review_logs` table exists with RLS enabled and correct SELECT/INSERT-only policies

**Implementation Note**: After all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: SRS Service and API Endpoints

### Overview

Wraps ts-fsrs in a typed service (`srs.ts`), then implements `GET /api/study/due` and `POST /api/study/review`. After this phase the entire backend for S-04 is testable via curl/Postman; no UI changes yet.

### Changes Required

#### 1. SRS service

**File**: `src/lib/services/srs.ts` (new file)

**Intent**: Encapsulate all ts-fsrs calls behind typed, pure-function helpers that keep the API route handlers thin — same architectural split as `generation.ts`. Returns plain objects serializable directly to DB column values.

**Contract**:

- Import from `ts-fsrs`: `createEmptyCard`, `fsrs`, `generatorParameters`, `Rating`, `State`, `type Card`, `type ReviewLog`
- Export `mapOutcomeToRating(outcome: ReviewOutcome): Rating` — maps `"again"→1`, `"hard"→2`, `"good"→3`, `"easy"→4`
- Export interface `FSRSCardFields` — mirrors the 9 nullable FSRS columns on `flashcards` (using `string | null` for timestamps, `number | null` for numerics)
- Export interface `ReviewLogFields` — mirrors `review_logs` insert columns (`rating`, `state`, `stability`, `difficulty`, `scheduled_days`, `reviewed_at` as ISO string)
- Export `scheduleReview(currentFields: FSRSCardFields | null, outcome: ReviewOutcome, now?: Date): { newCardFields: FSRSCardFields; reviewLogFields: ReviewLogFields }`:
  - If `currentFields` is null or `fsrs_state` is null: start from `createEmptyCard()`
  - Otherwise: rehydrate a `Card` from `currentFields`
  - Use `fsrs(generatorParameters())` with default parameters
  - Call `f.repeat(card, now ?? new Date())`, select the entry matching `mapOutcomeToRating(outcome)`
  - Return `newCardFields` (all 9 FSRS columns as DB-ready values) and `reviewLogFields` (rating, pre-review state, stability, difficulty, scheduled_days, reviewed_at)
  - The `state` in `reviewLogFields` is the **pre-review** state (from the input card, not the output)

---

#### 2. `GET /api/study/due`

**File**: `src/pages/api/study/due.ts` (new file)

**Intent**: Return up to 20 cards that are due now (or have never been studied) for the current user, plus the total count of all currently-due cards for the session progress indicator.

**Contract**:

- `export const prerender = false`
- `export async function GET(context)` — auth check (`context.locals.user`), Supabase client setup, 401/503 guards (same pattern as `deck/index.ts`)
- Due-card query: `SELECT * FROM flashcards WHERE user_id = [uid] AND status = 'accepted' AND (fsrs_due IS NULL OR fsrs_due <= NOW()) ORDER BY fsrs_due ASC NULLS FIRST LIMIT 20`
- Count query: `SELECT COUNT(*) FROM flashcards WHERE user_id = [uid] AND status = 'accepted' AND (fsrs_due IS NULL OR fsrs_due <= NOW())`
- Response: `StudyDueResponseDTO { cards: StudyCardDTO[], total_due: number }`

---

#### 3. `POST /api/study/review`

**File**: `src/pages/api/study/review.ts` (new file)

**Intent**: Accept one review grade for one card, apply ts-fsrs scheduling via `scheduleReview()`, update the card's FSRS columns (setting `first_reviewed_at` atomically on first grade), and append an immutable `review_logs` row.

**Contract**:

- `export const prerender = false`
- `export async function POST(context)` — Zod schema: `{ cardId: z.string().uuid(), outcome: z.enum(["again","hard","good","easy"]) }`
- Fetch flashcard: `SELECT * FROM flashcards WHERE id = [cardId] AND user_id = [uid] AND status = 'accepted'` — 404 if not found
- Capture `preReviewState` = `card.fsrs_state ?? 0` (State.New) for the review log
- Call `scheduleReview(card's FSRS fields or null if fsrs_state is null, outcome, new Date())`
- UPDATE flashcards (scoped to `id` AND `user_id`):
  ```sql
  UPDATE flashcards SET
    fsrs_due = $1, fsrs_stability = $2, fsrs_difficulty = $3,
    fsrs_scheduled_days = $4, fsrs_learning_steps = $5,
    fsrs_reps = $6, fsrs_lapses = $7, fsrs_state = $8, fsrs_last_review = $9,
    first_reviewed_at = COALESCE(first_reviewed_at, now())
  WHERE id = $10 AND user_id = $11
  ```
- INSERT into `review_logs`: `{ user_id, card_id: cardId, rating: mapOutcomeToRating(outcome), state: preReviewState, stability, difficulty, scheduled_days, reviewed_at: now-ISO }`
- Response: `SubmitReviewResponseDTO { scheduledFor: newCardFields.fsrs_due, outcome }`
- Error codes: 400 (Zod fail), 401 (unauth), 404 (card not found), 500 (DB error)

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes (new routes and service compile without errors)

#### Manual Verification

- `GET /api/study/due` returns 200 with correct cards array and `total_due` count for an authenticated user with accepted cards
- `POST /api/study/review` with valid `cardId` + `outcome` returns 200; `flashcards` FSRS columns are updated; a `review_logs` row is created; `first_reviewed_at` is set on the first call and unchanged on the second call to the same card
- 401 returned for unauthenticated requests to both routes
- 400 returned for invalid `outcome` value (e.g. `"perfect"`)
- 404 returned for a `cardId` that doesn't exist or belongs to another user

**Implementation Note**: After all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Study UI and Navigation

### Overview

Builds the `StudySession` React island (flip/grade flow, error recovery, three empty states, inline session summary), the `study.astro` SSR page shell that drives it, and adds Study entry points to Topbar, Home, and Deck page.

### Changes Required

#### 1. StudySession React island

**File**: `src/components/study/StudySession.tsx` (new file)

**Intent**: Self-contained React island that receives the initial card list server-side and manages the full session UX: flip-then-grade, review submission, error recovery on failure, and an inline summary on completion.

**Contract**:

- Props: `initialCards: StudyCardDTO[]`, `totalDue: number`
- Internal state phases:
  - `"studying"`: tracks `currentIndex`, `isFlipped` (false on advance), `isSubmitting`, `lastError: string | null`, and `grades: ReviewOutcome[]` accumulator
  - `"complete"`: holds the final `grades` array
- Studying state rendering:
  - Front visible at all times
  - Back visible only when `isFlipped`
  - "Show Answer" button visible only when `!isFlipped`
  - Four grade buttons (Again / Hard / Good / Easy) visible only when `isFlipped` and `!isSubmitting`
  - On grade tap: set `isSubmitting = true`, POST `/api/study/review` with `{ cardId, outcome }`:
    - Success: push outcome to `grades`, advance `currentIndex` (or transition to `"complete"` if last card), reset `isFlipped = false`, set `isSubmitting = false`, clear `lastError`
    - Error: set `lastError` (toast message), set `isSubmitting = false`, keep current card and flip state
  - Progress line: "Card {currentIndex + 1} of {initialCards.length}" + optional "{totalDue - initialCards.length} more due" suffix when `totalDue > initialCards.length`
- Complete state rendering:
  - Summary: "Session complete — {initialCards.length} card(s) reviewed"
  - Grade breakdown: Again: N, Hard: N, Good: N, Easy: N (computed from `grades` array)
  - "Back to Deck" `<a href="/deck">` button

---

#### 2. Study page SSR shell

**File**: `src/pages/study.astro` (new file)

**Intent**: Fetch all session state server-side to determine which UI branch to render before hydrating the island — same pattern as `deck.astro`.

**Contract**:

Server-side Supabase queries (using `createClient(request.headers, cookies)` — same as all other pages):

1. `SELECT COUNT(*) FROM flashcards WHERE user_id = [uid] AND status = 'accepted'`
2. If count > 0: run the same due-card query as `GET /api/study/due` (up to 20 cards + total_due count)
3. If due count = 0: `SELECT MIN(fsrs_due) FROM flashcards WHERE user_id = [uid] AND status = 'accepted' AND fsrs_due > NOW()` for the next-review timestamp

Three rendered branches:
1. `total_accepted = 0` → inline static message: "You have no cards yet. [Generate some →](`/generate`)"
2. `due_cards.length = 0` and `total_accepted > 0` → inline message: "All caught up! Next review: {formatted min_due}" (or "Check back later" if min_due is null)
3. `due_cards.length > 0` → `<StudySession initialCards={due_cards} totalDue={total_due} client:load />`

Uses the existing Astro layout component.

---

#### 3. Topbar navigation

**File**: `src/components/Topbar.astro`

**Intent**: Add "Study" as a third navigation link alongside Generate and My Deck.

**Contract**: Add `<a href="/study">Study</a>` following the existing nav-item markup pattern; active-state logic should follow the same pattern as the existing links.

---

#### 4. Home page quick-action

**File**: `src/pages/home.astro`

**Intent**: Add a Study quick-action card/section alongside the existing Generate and My Deck actions.

**Contract**: Add a Study entry using the existing action-card markup pattern; links to `/study`.

---

#### 5. Deck page "Start Study Session" entry point

**File**: `src/pages/deck.astro` or `src/components/deck/DeckManager.tsx`

**Intent**: Add a "Start Study Session" call-to-action on the deck page for users who have just finished reviewing their cards.

**Contract**: Add a button or link to `/study` in the deck page header or action area, using `cn()` + shadcn/ui Button consistent with the existing deck page style.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Authenticated user with accepted cards: `/study` renders the session; "Show Answer" reveals back; grade buttons appear after flip; each grade POSTs successfully; FSRS columns update on `flashcards`; `review_logs` row created
- After session, inline summary shows correct grade counts; "Back to Deck" navigates to `/deck`
- First grade on a card: `first_reviewed_at` is set; subsequent PATCH or DELETE on that card returns 403
- Empty state — no cards: message with link to `/generate` shown at `/study`
- Empty state — no due cards: "All caught up" message with next-review timestamp
- Study link appears in Topbar; Study action on Home page; "Start Study Session" on Deck page all navigate to `/study`
- Unauthenticated access to `/study` redirects to sign-in (existing middleware handles this automatically)
- Network error on grade submission: toast with error message, card and grade buttons remain active; re-grade succeeds

**Implementation Note**: After all automated verification passes, pause for manual confirmation to complete Phase 3.

---

## Testing Strategy

### Unit Tests

- `src/lib/services/srs.ts`:
  - `scheduleReview(null, "good")` returns non-null `newCardFields` with all 9 FSRS fields populated (first review on a new card)
  - `scheduleReview(existingCard, "again")` returns shorter `fsrs_scheduled_days` than `scheduleReview(existingCard, "good")`
  - `mapOutcomeToRating` correctly maps all four outcome strings to Rating 1/2/3/4
  - `scheduleReview` with `outcome: "again"` sets `fsrs_lapses` to `(previous_lapses + 1)` for a Review-state card

### Integration Tests

- `GET /api/study/due`: returns 200 with cards array; cards ordered NULLS FIRST; total_due ≥ cards.length
- `POST /api/study/review`: updates `flashcards` FSRS columns; inserts `review_logs` row; `first_reviewed_at` set on first call
- `POST /api/study/review` twice on same card: `first_reviewed_at` unchanged on second call (COALESCE)
- `POST /api/study/review` with deleted/other-user card: returns 404

### Manual Testing Steps

1. Navigate to `/study` with accepted cards; verify up to 20 cards load; progress line shows correct count
2. Flip a card; verify "Show Answer" works and grade buttons appear only after flip
3. Grade "Again"; verify toast does not appear; verify next card loads with front only
4. Simulate network error (DevTools offline); grade a card; verify toast appears and card stays
5. Complete all session cards; verify inline summary shows correct breakdown; "Back to Deck" works
6. Navigate to `/deck`; verify reviewed cards show lock icon; try editing → expect 403
7. Check `review_logs` in Supabase dashboard; confirm append-only (no delete/update policy visible)
8. Navigate to `/study` when no cards are due; verify "All caught up" message with timestamp
9. New user with no accepted cards: verify "Generate some cards" message at `/study`

## Performance Considerations

The partial index `ON flashcards (user_id, fsrs_due) WHERE status = 'accepted'` covers both the due-card query and the count query. At typical MVP deck sizes (tens to hundreds of cards per user), no caching layer is needed.

## Migration Notes

All FSRS columns added in Phase 1 are nullable with no `DEFAULT` values. Existing accepted cards have NULL FSRS fields and satisfy the due-card filter condition `(fsrs_due IS NULL OR fsrs_due <= NOW())` — they appear as "new" cards (never reviewed) and are served first (NULLS FIRST ordering).

## References

- Roadmap: `context/foundation/roadmap.md` (S-04, lines 124–135)
- PRD: `context/foundation/prd.md` (FR-008, FR-009, US-01 acceptance criteria, NFR guardrail)
- ts-fsrs Card interface (current, non-deprecated): `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`
- Existing service pattern: `src/lib/services/generation.ts`
- Existing API pattern: `src/pages/api/deck/index.ts:1–50`
- Lock enforcement pattern: `src/pages/api/deck/[id].ts:48–50`
- `first_reviewed_at` column: `supabase/migrations/20260608000000_add_first_reviewed_at.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database, Package, and Types

#### Automated

- [x] 1.1 npm install ts-fsrs completes; package in dependencies — be5c4f3
- [x] 1.2 npm run build passes with new types and migrations — be5c4f3
- [x] 1.3 npm run lint passes — be5c4f3

#### Manual

- [x] 1.4 Both migration files present with correct timestamp-prefixed names — be5c4f3
- [x] 1.5 FSRS columns visible on flashcards in Supabase dashboard after migration up — be5c4f3
- [x] 1.6 review_logs table exists with RLS enabled and SELECT/INSERT-only policies — be5c4f3

### Phase 2: SRS Service and API Endpoints

#### Automated

- [x] 2.1 npm run lint passes
- [x] 2.2 npm run build passes

#### Manual

- [ ] 2.3 GET /api/study/due returns 200 with cards array and total_due
- [ ] 2.4 POST /api/study/review returns 200; FSRS columns updated; review_logs row created; first_reviewed_at set on first grade and unchanged on second
- [ ] 2.5 401 returned for unauthenticated requests to both routes
- [ ] 2.6 400 returned for invalid outcome value; 404 for unknown or foreign cardId

### Phase 3: Study UI and Navigation

#### Automated

- [ ] 3.1 npm run lint passes
- [ ] 3.2 npm run build passes

#### Manual

- [ ] 3.3 Full session: flip works; all four grades submit successfully; FSRS columns updated after each grade
- [ ] 3.4 first_reviewed_at set after first grade; PATCH/DELETE on that card returns 403
- [ ] 3.5 Session complete: inline summary with grade counts; Back to Deck navigates to /deck
- [ ] 3.6 Empty state (no accepted cards): message with link to /generate
- [ ] 3.7 Empty state (no due cards): "All caught up" message with next-review timestamp
- [ ] 3.8 Study link in Topbar; Study card on Home; Start Study button on Deck page
- [ ] 3.9 Network error on grade: toast shown, card and grade buttons remain active, re-grade succeeds
- [ ] 3.10 Unauthenticated /study redirects to sign-in
