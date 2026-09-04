# Atomic Save to Deck (S-02) — Implementation Plan

## Overview

Build the curation layer on top of S-01's draft generation. A logged-in user who has just generated draft cards can now accept, inline-edit, or discard each one. All curation decisions are staged in local React state; a single API call applies them — accepted and edited cards land in the deck (`status → accepted`), discarded cards are hard-deleted. On success the user is redirected to `/dashboard` with a "N cards saved" success banner.

## Current State Analysis

S-01 is fully implemented. Draft flashcards are persisted immediately when the user generates cards — they appear in `GenerateForm.tsx` as a read-only list. The `Flashcard` entity already has `status: 'draft' | 'accepted'`, and the `flashcards` table has `UPDATE` and `DELETE` RLS policies scoped to the owning user. No accept/edit/discard controls exist in the UI, and no curation API endpoint exists.

### Key Discoveries

- `src/components/generation/GenerateForm.tsx:47` — response is cast as `{ cards?: Flashcard[]; error?: string }` and `generationId` from `GenerateResponseDTO` is silently discarded; must be stored in state
- `src/types.ts:1` — `Flashcard` and `GenerateResponseDTO` already exist; `SaveCurationRequestDTO` / `SaveCurationResponseDTO` are new DTOs needed for this slice
- `supabase/migrations/20260606000000_create_flashcards.sql:32` — `status CHECK (status IN ('draft', 'accepted'))` — no schema migration needed (no new status values)
- `supabase/migrations/20260606000000_create_flashcards.sql:40-49` — `flashcards_update_own` and `flashcards_delete_own` RLS policies already in place
- `src/pages/api/generate.ts` — API route pattern to follow: `export const prerender = false`, Zod validation, `context.locals.user`, `createClient`, `json()` helper
- `src/pages/dashboard.astro` — SSR page can read `Astro.url.searchParams` server-side for the `?saved=N` param

## Desired End State

After this change, a logged-in user who has just generated draft cards sees an interactive curation panel: each card has Accept, Edit, and Discard buttons. Clicking Accept marks the card green; clicking Edit expands inline text fields; clicking Discard greys it out. A "Save N cards to deck" button (disabled until ≥1 card is accepted or edited) submits all decisions in a single API call. On success the user is redirected to `/dashboard?saved=N`, which shows a "✓ N cards saved to your deck" banner. On network failure the error is shown inline and all curation decisions are preserved for retry.

To verify: generate 5 cards, accept 2, edit 1, discard 1, leave 1 undecided. After save: 3 rows in `flashcards` with `status='accepted'` (including the edited one with new content), 1 row deleted (discarded), 1 row still `status='draft'` (undecided). Dashboard shows "✓ 3 cards saved to your deck".

### Key Discoveries

- No new migration needed — hard DELETE handles discard; UPDATE handles accept/edit; the status field already covers the transition
- `generationId` must be wired through: stored in `GenerateForm` state after generation, passed as a prop to `CurationPanel`, included in the save request body
- Sequential DB operations are safe to retry — DELETE of an already-absent row returns `count: 0` (not an error); UPDATE of an already-accepted card is a no-op
- Cards with no decision (neither accepted, edited, nor discarded) remain as `status='draft'` in the DB — they are not acted on by this slice

## What We're NOT Doing

- Adding a `discarded` status value — discards are hard-deleted
- Adding a `decks` table — "deck" means all `status='accepted'` flashcards for the user
- Using a Postgres RPC function for DB-level atomicity — idempotent sequential calls are sufficient for MVP
- Adding "Accept all" or "Discard all" bulk shortcuts
- Writing automated tests — no test runner is configured
- Adding `first_reviewed_at` to the `flashcards` schema — S-03 responsibility
- Adding `deck_id` FK to `flashcards` — deferred per S-01 plan note
- A separate curation route (`/review/[generationId]`) — curation happens on `/generate`

## Implementation Approach

Three phases in dependency order. Phase 1 (types + API route) has no UI dependency. Phase 2 (curation UI) calls the Phase 1 endpoint. Phase 3 (dashboard banner) receives the redirect from Phase 2.

The UI architecture: `GenerateForm.tsx` is extended to store `generationId` alongside `cards`. A new `CurationPanel.tsx` is added under `src/components/generation/` and receives `cards`, `generationId`, and an `onReset` callback. `CurationPanel` owns all curation state, the save call, and post-save navigation via `window.location.href`.

## Critical Implementation Details

**generationId currently discarded:** `GenerateForm.tsx:47` casts the API response as `{ cards?: Flashcard[]; error?: string }`, dropping `generationId`. The cast must become `GenerateResponseDTO & { error?: string }` and `generationId` must be stored in a new state variable before `CurationPanel` can include it in the save request.

**Idempotency for retries:** The save handler runs three DB operations in order — DELETE discarded, UPDATE accepted, UPDATE edited. If an intermediate operation fails, the frontend must preserve `decisions` state so the user can retry. Because DELETE of an absent row is a no-op and UPDATE of an already-accepted row is a no-op, retrying the full batch is safe with no side effects.

---

## Phase 1: Types & Save-Deck API Route

### Overview

Add two DTOs to `src/types.ts`, then create `POST /api/save-deck` — the endpoint that accepts all curation decisions in one request and applies them with sequential idempotent DB operations.

### Changes Required

#### 1. New DTOs

**File**: `src/types.ts`

**Intent**: Declare the request and response shapes for the curation save operation so the API route and UI share a typed contract.

**Contract**: Append two interfaces after the existing `GenerateResponseDTO`:

```typescript
// Input to POST /api/save-deck
export interface SaveCurationRequestDTO {
  generationId: string;
  accepted: string[];                                        // card IDs to mark status='accepted'
  edited: { id: string; front: string; back: string }[];    // cards to update content + mark accepted
  discarded: string[];                                       // card IDs to hard-delete
}

// Response from POST /api/save-deck
export interface SaveCurationResponseDTO {
  savedCount: number;  // accepted.length + edited.length
}
```

#### 2. Save-deck API route

**File**: `src/pages/api/save-deck.ts` *(new file)*

**Intent**: Thin API handler that validates the curation batch, then applies three sequential idempotent DB operations — DELETE discarded, UPDATE accepted, UPDATE edited — and returns the count of cards saved to the deck.

**Contract**:

```typescript
export const prerender = false;
export const POST: APIRoute = async (context) => { ... }
```

Zod validation schema:

```typescript
const RequestSchema = z.object({
  generationId: z.string().uuid(),
  accepted: z.array(z.string().uuid()),
  edited: z.array(z.object({
    id: z.string().uuid(),
    front: z.string().min(1).max(1000),
    back: z.string().min(1).max(1000),
  })),
  discarded: z.array(z.string().uuid()),
}).refine(
  (d) => d.accepted.length + d.edited.length > 0,
  { message: "At least one card must be accepted or edited" }
);
```

Happy path:
1. Parse + validate body with Zod — return `400 { error }` on failure.
2. Get `user` from `context.locals.user` — middleware guarantees non-null for non-public routes; return `401` if absent.
3. Create Supabase client — return `503` if DB not configured.
4. If `discarded.length > 0`: delete rows — `.from("flashcards").delete().in("id", discarded).eq("user_id", user.id).eq("generation_id", generationId)`. Return `500` on DB error.
5. If `accepted.length > 0`: update status — `.from("flashcards").update({ status: "accepted" }).in("id", accepted).eq("user_id", user.id).eq("generation_id", generationId)`. Return `500` on DB error.
6. `Promise.all()` over `edited`: for each card, `.from("flashcards").update({ status: "accepted", front: card.front, back: card.back }).eq("id", card.id).eq("user_id", user.id).eq("generation_id", generationId)`. Return `500` if any Promise rejects.
7. Return `200 { savedCount: accepted.length + edited.length }` matching `SaveCurationResponseDTO`.

Error shape: `{ error: string }` for all non-2xx responses. Extract the `json()` helper (`generate.ts:15`) to `src/lib/api-utils.ts` and import it in both `generate.ts` and `save-deck.ts`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Unauthenticated POST → `401 {"error":"Unauthorized"}` (handled by middleware)
- Valid payload with `accepted: [id1, id2]`, `edited: [{id: id3, front: "Q", back: "A"}]`, `discarded: [id4]` → `200 { savedCount: 3 }`; rows updated in Supabase Studio; discarded row is gone; undecided row still `status='draft'`
- Payload with `accepted: [], edited: []` (discarded only) → `400 {"error":"At least one card must be accepted or edited"}`
- Payload with a non-UUID string in `accepted` → `400`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Curation UI

### Overview

Extend `GenerateForm.tsx` to store `generationId` from the generate API response. Extract a new `CurationPanel.tsx` component that renders interactive per-card controls (Accept / Edit / Discard) with staged state, a Save button, inline error handling, and post-save navigation.

### Changes Required

#### 1. Wire `generationId` in GenerateForm

**File**: `src/components/generation/GenerateForm.tsx`

**Intent**: Store `generationId` alongside `cards` so it can be forwarded to `CurationPanel`. Replace the existing read-only card list section with `<CurationPanel>`.

**Contract**:
- Add `const [generationId, setGenerationId] = useState<string | null>(null)` alongside the existing state variables.
- In `handleSubmit`, change the response cast from `{ cards?: Flashcard[]; error?: string }` to `GenerateResponseDTO & { error?: string }` and add `setGenerationId(data.generationId ?? null)` immediately after `setCards(data.cards ?? [])`.
- Replace the `{cards !== null && (...)}` block with:
  ```typescript
  {cards !== null && generationId !== null && (
    <CurationPanel
      cards={cards}
      generationId={generationId}
      onReset={() => { setCards(null); setGenerationId(null); }}
    />
  )}
  ```
- Import `CurationPanel` and `GenerateResponseDTO` at the top of the file.

#### 2. CurationPanel component

**File**: `src/components/generation/CurationPanel.tsx` *(new file)*

**Intent**: Self-contained component that manages per-card curation decisions in local state, renders Accept / Edit / Discard controls for each card, and drives the save API call. On success, navigates to `/dashboard?saved=N` via `window.location.href`. On error, shows inline error and preserves decisions for retry. Calls `onReset()` on successful save to clear parent state.

**Contract**:

Props interface:
```typescript
interface CurationPanelProps {
  cards: Flashcard[];
  generationId: string;
  onReset: () => void;
}
```

Per-card decision type (file-local):
```typescript
type CardDecision =
  | { action: "accepted" }
  | { action: "discarded" }
  | { action: "editing"; editFront: string; editBack: string }
  | { action: "edited"; editFront: string; editBack: string };
```

State:
- `decisions: Map<string, CardDecision>` — `card.id → decision`; initialized as empty (undecided cards remain as drafts)
- `isSaving: boolean` — default `false`
- `saveError: string | null` — default `null`

Save payload construction (derived from `decisions`):
- `accepted`: IDs where `action === "accepted"`
- `edited`: entries where `action === "edited"`, mapped to `{ id, front: editFront, back: editBack }`
- `discarded`: IDs where `action === "discarded"`
- `savedCount = accepted.length + edited.length`

Save button: disabled when `savedCount === 0 || isSaving`. Label: `"Save ${savedCount} card${savedCount === 1 ? '' : 's'} to deck"`.

On save success: call `onReset()`, then `window.location.href = \`/dashboard?saved=${savedCount}\``.

On save error: set `saveError` from `data.error ?? "Failed to save — please try again"`. Keep `decisions` state intact. Re-enable save button (`isSaving = false`).

Render structure:
- Section heading: `"Review {cards.length} draft card{s}"` above the list
- `<ul>` of cards — each rendered with:
  - Card header with card number
  - Front / Back display (or editable textareas when `action === "editing"`)
  - Three action buttons: Accept / Edit / Discard (the active decision is visually indicated; clicking the currently active action reverts to undecided)
  - When editing: two `<textarea>` elements + "Confirm" button (sets `action: "edited"`) + "Cancel" button (reverts decision to pre-edit state)
- Footer sticky section: Save button + `saveError` display (same error style as `GenerateForm`)

Visual treatment using `cn()` from `@/lib/utils`:
- Undecided card: `border-white/10 bg-white/5`
- Accepted / Edited card: `border-green-500/40 bg-green-900/20`
- Discarded card: `border-white/5 opacity-40` with `line-through` on text
- Editing card: expanded with textareas in place of front/back text

All action buttons follow the existing button styling patterns from `GenerateForm.tsx` and `src/components/ui/button.tsx`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- After generation, the read-only card list is replaced by the curation panel with Accept / Edit / Discard buttons per card
- Clicking Accept: card border turns green; Save button counter increments; clicking Accept again reverts to undecided
- Clicking Edit: card expands with two textareas pre-filled with current front/back; editing and clicking Confirm shows updated content and marks as accepted (green); clicking Cancel reverts
- Clicking Discard: card becomes muted with strikethrough text; clicking Discard again reverts to undecided
- Save button is disabled when 0 cards are accepted or edited
- Clicking Save fires `POST /api/save-deck` with correct `generationId`, `accepted`, `edited`, `discarded` arrays (visible in DevTools Network tab)
- On success: browser navigates to `/dashboard?saved=N` with correct count
- On simulated network error: error message appears below Save button; all curation decisions are preserved; re-enabling network and retrying succeeds

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Post-Save Dashboard Feedback

### Overview

Read the `?saved=N` query param on the `/dashboard` SSR page and render a dismissible success banner when the user arrives from the curation flow.

### Changes Required

#### 1. Dashboard success banner

**File**: `src/pages/dashboard.astro`

**Intent**: Surface a clear "cards saved to deck" confirmation when the user is redirected from the curation save flow.

**Contract**:
- In the frontmatter, add: `const savedCount = parseInt(Astro.url.searchParams.get("saved") ?? "0", 10) || 0;`
- Render a dismissible banner immediately inside the page body when `savedCount > 0`:

```astro
{savedCount > 0 && (
  <div
    id="saved-banner"
    class="mb-6 flex items-center justify-between rounded-lg border border-green-500/30 bg-green-900/30 px-4 py-3 text-sm text-green-300"
  >
    <span>✓ {savedCount} {savedCount === 1 ? "card" : "cards"} saved to your deck</span>
    <button
      onclick="document.getElementById('saved-banner').remove()"
      class="ml-4 text-green-300/60 hover:text-green-300"
      aria-label="Dismiss"
    >
      ×
    </button>
  </div>
)}
```

Style follows the existing error message convention (`border-red-500/30 bg-red-900/30 text-red-300`) but with green tokens. No React island needed — the dismiss action is a trivial inline `onclick`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Navigating to `/dashboard?saved=5` shows "✓ 5 cards saved to your deck" with a dismiss button
- Navigating to `/dashboard` (no param) shows no banner
- Navigating to `/dashboard?saved=0` shows no banner
- Clicking dismiss removes the banner without a page reload
- Full end-to-end: generate → curate (accept some, edit one, discard one) → Save → redirected to `/dashboard` → banner visible with correct count

**Implementation Note**: After completing this phase and all automated verification passes, the complete S-02 curation loop is functional. Verify the full end-to-end flow before closing this change.

---

## Testing Strategy

### Manual Testing Steps

1. Start dev server: `npm run dev` (with `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` set in `.dev.vars`)
2. Sign in as a test user; navigate to `/generate`
3. Paste ≥50 chars of text; generate 5 cards
4. Verify the read-only list is replaced by the curation panel with Accept / Edit / Discard buttons
5. Accept 2 cards; edit 1 card (change the front text); discard 1 card; leave 1 undecided
6. Verify Save button shows "Save 3 cards to deck" and is enabled
7. Click Save; inspect DevTools Network tab — verify POST to `/api/save-deck` with `generationId`, `accepted: [2 ids]`, `edited: [{id, front, back}]`, `discarded: [1 id]`
8. Verify redirect to `/dashboard?saved=3` and "✓ 3 cards saved to your deck" banner
9. In Supabase Studio: verify 2 rows `status='accepted'` (original text), 1 row `status='accepted'` with edited content, 1 row still `status='draft'` (undecided), 1 row deleted (discarded)
10. Click dismiss on the dashboard banner — verify it disappears without page reload
11. Retry test: throttle network in DevTools; click Save; verify error shown + decisions preserved; re-enable network; retry — verify success

## Performance Considerations

The edited-card UPDATE loop runs at most 15 iterations (one per card in the largest batch). Each is a single Supabase HTTP call. Workers CPU impact is negligible — all operations are I/O. No caching needed.

## Migration Notes

No DB migration required. The existing `flashcards` table and its `status` CHECK constraint fully support all S-02 operations (`draft → accepted`). The `UPDATE` and `DELETE` RLS policies are already in place from S-01.

## References

- Roadmap: `context/foundation/roadmap.md` — S-02 section
- PRD: `context/foundation/prd.md` — FR-005, US-01
- Prerequisite plan: `context/changes/s-01/plan.md`
- Schema: `supabase/migrations/20260606000000_create_flashcards.sql`
- Shared types: `src/types.ts`
- Generation form: `src/components/generation/GenerateForm.tsx`
- Generate API route pattern: `src/pages/api/generate.ts`
- Dashboard page: `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Types & Save-Deck API Route

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — a8e4c8a
- [x] 1.2 Build passes: `npm run build` — a8e4c8a

#### Manual

- [x] 1.3 Unauthenticated POST → `401`
- [x] 1.4 Valid payload (accepted, edited, discarded) → `200 { savedCount: N }`; DB rows updated/deleted correctly
- [x] 1.5 Payload with empty accepted+edited → `400`

### Phase 2: Curation UI

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 9dd7a9f
- [x] 2.2 Build passes: `npm run build` — 9dd7a9f

#### Manual

- [x] 2.3 Curation panel appears after generation with Accept / Edit / Discard per card — 9dd7a9f
- [x] 2.4 Accept / Edit / Discard controls update visual state and Save button count — 9dd7a9f
- [x] 2.5 Save button disabled when 0 cards accepted or edited — 9dd7a9f
- [x] 2.6 Save fires correct API payload; navigates to `/dashboard?saved=N` — 9dd7a9f
- [x] 2.7 Save error shows inline; decisions preserved; retry succeeds — 9dd7a9f

### Phase 3: Post-Save Dashboard Feedback

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [x] 3.3 `/dashboard?saved=5` shows "✓ 5 cards saved to your deck" banner
- [x] 3.4 `/dashboard` (no param) shows no banner
- [x] 3.5 `/dashboard?saved=0` shows no banner
- [x] 3.6 Clicking dismiss removes the banner without a page reload
- [x] 3.7 Full end-to-end flow: generate → curate → save → dashboard banner with correct count
