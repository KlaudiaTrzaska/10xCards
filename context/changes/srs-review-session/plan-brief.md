# SRS Review Session — Plan Brief

> Full plan: `context/changes/srs-review-session/plan.md`

## What & Why

S-04 closes the North Star loop: users have already generated cards (S-01), curated them into a deck (S-02), and can manage them (S-03) — now they can actually study. The session uses the FSRS algorithm (via ts-fsrs) to schedule reviews, presents up to 20 due cards, lets users grade each one (Again / Hard / Good / Easy), and persists an immutable review history that must never be lost (NFR guardrail).

## Starting Point

S-01 through S-03 are fully implemented. The `flashcards` table has `status = 'accepted'` cards as the study pool and a `first_reviewed_at` column that enforces the edit/delete lock (S-03) but is currently never written. No SRS library is installed; no study routes, service, or UI exist.

## Desired End State

Users navigate to `/study`, flip through up to 20 due (or new) flashcards, and grade each with Again / Hard / Good / Easy. ts-fsrs computes the next review date after each grade; the updated scheduling state is written back to `flashcards` and an immutable row is appended to `review_logs`. After the last card an inline summary shows the grade breakdown. Two distinct empty states handle new users (no cards yet) and fully-reviewed queues (all done, next review in X). The first grade on any card activates the S-03 edit/delete lock.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| SR algorithm + library | ts-fsrs (FSRS) | Workers-compatible TypeScript ESM; unblocks roadmap open question #1; more accurate than SM-2 | Plan |
| Session model | Stateless (no DB session entity) | Each grade is one independent API call; simpler schema; stateless model handles pause/resume naturally | Plan |
| FSRS state storage | 9 nullable columns on `flashcards` | Single-table due-card query with no JOIN; same RLS policy; NULL = new card | Plan |
| Card selection | Up to 20, `NULLS FIRST` ordering | Predictable session length; new (unstudied) cards appear before overdue | Plan |
| Review grades | Again / Hard / Good / Easy (FSRS 1–4) | Direct ts-fsrs Rating mapping; FR-009 requirement | Plan |
| Empty state | Two distinct messages | Clearest UX: new users vs. fully-reviewed queue are different situations | Plan |
| UI flip flow | Front → Show Answer → grade buttons | Standard SRS UX; prevents grading before recall attempt | Plan |
| `first_reviewed_at` write | `COALESCE` in review UPDATE | Atomic with FSRS write; activates S-03 lock on first grade with no extra round trip | Plan |
| Navigation entry points | Topbar + Home + Deck page | Discovery from all major surfaces the user visits | Plan |
| Error recovery | Toast + retry, keep current card | No lost reviews; NFR guardrail satisfied | Plan |
| Session completion | Inline grade-breakdown summary | Satisfying loop; no extra API call (data already in client state) | Plan |

## Scope

**In scope:**
- `npm install ts-fsrs`
- Migration: 9 FSRS nullable columns on `flashcards` + partial index
- Migration: `review_logs` table (append-only, RLS SELECT + INSERT only)
- `src/lib/services/srs.ts` — scheduleReview wrapper
- `GET /api/study/due` + `POST /api/study/review`
- `src/components/study/StudySession.tsx` React island
- `src/pages/study.astro` SSR shell with three state branches
- Navigation updates: Topbar, Home page, Deck page
- `first_reviewed_at` write (activates S-03 lock)
- `src/types.ts` extensions: FSRS fields, `ReviewOutcome`, `ReviewLog`, study DTOs

**Out of scope:**
- Session history page / analytics dashboard
- User-configurable FSRS parameters
- Session resume via localStorage
- Configurable session size
- Export to Anki
- Multiple deck separation (flat single-pool per PRD)

## Architecture / Approach

```
/study (SSR)
  → Supabase: count accepted cards
      → 0 cards:  render "You have no cards yet" + link to /generate
  → Supabase: fetch up to 20 due cards + total_due count
      → 0 due:   render "All caught up — next review: {timestamp}"
  → 1+ due:   <StudySession initialCards={cards} totalDue={N} client:load />

StudySession island
  → Show card front
  → "Show Answer" → reveal back
  → Grade buttons (Again / Hard / Good / Easy)
  → POST /api/study/review
      → srs.ts: scheduleReview(currentFSRSFields | null, outcome)
      → UPDATE flashcards (FSRS cols + COALESCE first_reviewed_at)
      → INSERT review_logs
      → return scheduledFor
  → Advance to next card (or transition to summary if last)

Session complete
  → Inline summary: grade breakdown
  → "Back to Deck" → /deck
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database, Package, and Types | ts-fsrs installed; FSRS columns on `flashcards`; `review_logs` table; types updated | Migration verification via `supabase db push` (CLI against remote — no local Postgres) |
| 2. SRS Service and API Endpoints | `srs.ts`; `GET /api/study/due`; `POST /api/study/review` with atomic `first_reviewed_at` write | ts-fsrs Workers runtime compatibility (pure ESM confirmed; verify after install) |
| 3. Study UI and Navigation | Full flip-then-grade session; three empty states; Topbar + Home + Deck nav updates | Review error recovery must keep card in place and never lose a submitted grade |

**Prerequisites:** S-02 and S-03 fully implemented (accepted cards in `flashcards`, `first_reviewed_at` column present — both confirmed in codebase research).

**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- ts-fsrs `elapsed_days` is deprecated (to be removed in v6.0.0) — the plan intentionally excludes it from the schema; verify the installed version's API before coding
- FSRS default parameters (`request_retention = 0.9`, `maximum_interval = 36500`) are assumed reasonable for MVP; no user configuration is in scope
- No local Supabase — migration verification uses `supabase db push` (CLI against remote); see lessons.md
- `review_logs` rows for a card are safe under cascade-delete because the S-03 lock (`first_reviewed_at IS NOT NULL`) prevents deletion of any reviewed card

## Success Criteria (Summary)

- User completes a full session: flip → grade → FSRS scheduling written to DB → inline summary appears after last card
- Every submitted grade is persisted; a network error during submission shows a toast and keeps the card visible for retry — no grade is silently lost
- `first_reviewed_at` is set on first grade; S-03 edit/delete lock activates correctly for all reviewed cards
