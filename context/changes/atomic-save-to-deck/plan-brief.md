# Atomic Save to Deck (S-02) — Plan Brief

> Full plan: `context/changes/atomic-save-to-deck/plan.md`

## What & Why

S-01 generates draft flashcards and persists them to the DB. S-02 adds the curation layer: the user evaluates each draft card (accept / inline-edit / discard), then submits all decisions at once in a single API call. This closes the first half of the core product loop — paste text → AI drafts → user-curated deck — and satisfies FR-005 (per-card curation before deck entry) and the US-01 acceptance criterion that at least one card must be explicitly accepted before it enters the deck.

## Starting Point

Draft cards are already saved as `status='draft'` rows in the `flashcards` table by `POST /api/generate` (S-01, complete). The `GenerateForm` component displays them as a read-only list — no accept/edit/discard controls exist. The `flashcards` table has UPDATE and DELETE RLS policies, and the status field already supports the `draft → accepted` transition. `generationId` is returned by the generate API but is currently unused in the UI.

## Desired End State

After generation, the user sees an interactive per-card panel: Accept, Edit (inline textareas), and Discard buttons on each card. Decisions are staged in React state — nothing hits the DB until the user explicitly clicks Save. A "Save N cards to deck" button (enabled once ≥1 card is accepted or edited) fires a single POST to `/api/save-deck`: accepted and edited cards become `status='accepted'`; discarded cards are hard-deleted; undecided cards remain as drafts. The user lands on `/dashboard` with a dismissible "✓ N cards saved to your deck" banner.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Curation UX model | Staged batch (single Save call) | True atomicity: nothing lands in DB until user commits; matches roadmap requirement |
| Discard behavior | Hard DELETE | No zombie draft rows; simpler "your deck" query (just `status='accepted'`) |
| Edit UX | Inline textareas | Stays in curation flow; no dialog component needed |
| Curation location | Same `/generate` page | Shortest path; avoids new SSR route + server-side data fetch |
| Post-save destination | `/dashboard?saved=N` | Clear completion signal; deck page (S-03) doesn't exist yet |
| Save error handling | Inline error, preserve state, allow retry | Idempotent DB ops make retry safe; no curation work is lost |
| DB atomicity | Sequential idempotent calls | DELETE + UPDATE are both safe to re-run; Postgres RPC is over-engineering for MVP |
| Accept all shortcut | No | Per-card review aligns with the ≥75% acceptance rate PRD success metric |

## Scope

**In scope:**
- `POST /api/save-deck` API route with Zod validation and three sequential idempotent DB operations
- `CurationPanel.tsx` — new React component with per-card Accept / Edit (inline) / Discard controls and a staged Save button
- `GenerateForm.tsx` — extended to store `generationId` and render `CurationPanel` instead of the read-only list
- Two new DTOs in `src/types.ts` (`SaveCurationRequestDTO`, `SaveCurationResponseDTO`)
- Dashboard success banner (`?saved=N` query param → inline green banner)

**Out of scope:**
- New DB migration (existing schema is sufficient)
- `discarded` status value — discards are hard-deleted
- `decks` table — deck = all `status='accepted'` cards for user
- Accept all / Discard all shortcuts
- Automated tests
- `first_reviewed_at` field (S-03)
- Separate `/review/[generationId]` route

## Architecture / Approach

Cards already exist in the DB as `status='draft'`. S-02 adds three DB mutations applied from a single API route:
1. `DELETE` discarded rows (scoped by `user_id` + `generation_id`)
2. `UPDATE status='accepted'` for accepted rows
3. `UPDATE status='accepted', front, back` for edited rows (sequential loop, max 15)

The UI in `CurationPanel.tsx` maintains a `Map<cardId, CardDecision>` in React state. On Save, this map is converted to `{ generationId, accepted[], edited[], discarded[] }` and sent to `/api/save-deck`. All three DB operations are idempotent, making retry on error safe without side effects.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Types & Save-Deck API Route | `POST /api/save-deck` with Zod validation and idempotent DB mutations | None significant — no schema changes needed |
| 2. Curation UI | `CurationPanel.tsx` with per-card controls; `GenerateForm.tsx` wired to pass `generationId` | Per-card state machine complexity; `generationId` wiring is easy to miss |
| 3. Post-Save Dashboard Feedback | `/dashboard` renders "✓ N cards saved" banner from `?saved=N` query param | Trivial — read query param server-side, render conditional banner |

**Prerequisites:** S-01 fully implemented (all 5 phases complete, commit `12a114e`)  
**Estimated effort:** ~1–2 sessions across 3 phases

## Open Risks & Assumptions

- **Partial-save between phases:** if the DELETE succeeds but the UPDATE fails, some cards are deleted but none are accepted — state is inconsistent until retry. Retry is safe (idempotent) but the user could close the tab between the two ops. Acceptable for MVP given the interactive context.
- **Undecided draft accumulation:** cards not acted on remain as `status='draft'` in the DB indefinitely. S-03 (deck management) will provide cleanup; this slice does not.

## Success Criteria (Summary)

- User can accept, edit, and discard draft cards from the generate page and commit all decisions with a single Save action
- Accepted and edited cards appear as `status='accepted'` in the DB; discarded cards are deleted; undecided drafts are unchanged
- `/dashboard` confirms the number of saved cards with a dismissible success banner
