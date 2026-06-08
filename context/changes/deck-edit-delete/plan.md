# Deck Edit & Delete (S-03) — Implementation Plan

## Overview

Build the deck management layer on top of S-02's curation flow. A logged-in user can visit `/deck` to browse all accepted cards (20 per page), manually create a new flashcard, edit any unlocked card inline via a modal, and delete unlocked cards with confirmation. Cards locked by their first study review (`first_reviewed_at IS NOT NULL`) have their Edit and Delete controls disabled in the UI, and the API enforces the same constraint with a 403. A `first_reviewed_at timestamptz NULL` column is added to `flashcards` so S-04 can populate it on the first review without a follow-up migration.

## Current State Analysis

S-02 is fully implemented. The `flashcards` table has `id`, `user_id`, `generation_id` (nullable), `front`, `back`, `status ('draft'|'accepted')`, `created_at`. RLS policies for SELECT, INSERT, UPDATE, DELETE scoped to `user_id` are all in place. There is no `first_reviewed_at` column yet. No deck-browsing page or CRUD API routes exist. The only product pages are `/generate` and `/dashboard`. The Topbar has no product navigation links.

### Key Discoveries

- `supabase/migrations/20260606000000_create_flashcards.sql` — existing schema; `first_reviewed_at` is absent; needs a new migration
- `src/types.ts` — `Flashcard` interface does not yet include `first_reviewed_at`; new DTOs needed
- `src/pages/api/save-deck.ts` — canonical API route pattern: `prerender = false`, Zod, `context.locals.user`, `createClient`, `json()` helper
- `src/lib/api-utils.ts` — exports `json(data, status?)` helper; all API routes import it
- `src/components/generation/CurationPanel.tsx` — React island pattern to follow; no Dialog/modal; uses inline Tailwind + `cn()`
- `src/components/ui/` — only `Button` and `LibBadge` exist; **Dialog is not installed** — must run `npx shadcn@latest add dialog` before Phase 3
- `src/components/Topbar.astro` — shows Dashboard link for authed users; no product links; needs "My Deck" added
- `src/pages/dashboard.astro` — Astro-only page; no React islands; needs a deck summary/link card

## Desired End State

A logged-in user navigates to `/deck` (via the Topbar or dashboard), sees all their accepted cards paginated 20 per page with a total count, can manually create a card via a modal, edit any unlocked card via the same modal, and delete with a confirm step. Cards with `first_reviewed_at` set display a lock badge; Edit and Delete buttons are disabled. A "My Deck" link appears in the Topbar. The dashboard has a deck summary card linking to `/deck`.

To verify: create 3 cards manually, edit one, delete one. Confirm 2 remain with `status='accepted'`. Set `first_reviewed_at` on one row directly in Supabase Studio — confirm that card's Edit/Delete buttons are disabled and a direct PATCH/DELETE API call returns 403.

### Key Discoveries

- `generation_id` is already nullable — manually created cards (`generation_id: null`) are supported without schema changes
- `flashcards_update_own` and `flashcards_delete_own` RLS policies already exist — API routes only need to add the lock check
- Supabase count query: `.select("*", { count: "exact" })` with `.range(offset, offset + PAGE_SIZE - 1)` returns total for pagination
- No client-side Supabase — React island fetches via API routes only

## What We're NOT Doing

- Adding a `decks` table — "deck" means all `status='accepted'` flashcards for the user (consistent with S-02)
- Showing draft cards on the deck page — deck view is accepted-only
- Bulk edit or bulk delete
- Soft-delete — deletions are hard (matching S-02's discard pattern)
- Undo / redo for deleted cards
- Writing automated tests — no test runner configured
- Sorting or filtering the deck list (always sorted newest first)
- Inline editing (edit happens in the modal)
- Any UI for `first_reviewed_at` itself — that field is populated by S-04

## Implementation Approach

Four phases in dependency order. Phase 1 (schema + types) is the foundation. Phase 2 (4 API routes) depends on the updated types. Phase 3 (UI) depends on Phase 2. Phase 4 (navigation) depends on Phase 3 for the route to exist.

The React island (`DeckManager.tsx`) handles all mutable state: current page, the card list, modal state (open/closed, mode create/edit, selected card), and delete confirmation. It fetches from the API routes. A sibling `CardModal.tsx` receives the card being edited (or null for create) and an `onSave` callback.

## Critical Implementation Details

**Dialog install required before Phase 3:** `npx shadcn@latest add dialog` must run before writing `CardModal.tsx`. The resulting file lands in `src/components/ui/dialog.tsx`.

**Lock check order in API routes:** Read the card's `first_reviewed_at` before applying any mutation. Fetch the specific row with `.eq("id", id).eq("user_id", user.id).single()` — if the row is absent return 404; if `first_reviewed_at` is non-null return 403.

**Pagination `range` semantics:** Supabase `.range(from, to)` is inclusive on both ends. For page 1, page size 20: `from = 0`, `to = 19`. For page 2: `from = 20`, `to = 39`.

**Database type update:** `first_reviewed_at` must be added to `Database["public"]["Tables"]["flashcards"]["Row"]`, `Insert`, and `Update` in `src/types.ts` or TypeScript will reject the field in query results.

---

## Phase 1: Schema Migration & Types

### Overview

Add `first_reviewed_at` to the `flashcards` table and update the shared TypeScript types with the new column and four new DTOs used by the API routes and the React island.

### Changes Required

#### 1. Schema migration

**File**: `supabase/migrations/20260608000000_add_first_reviewed_at.sql` *(new file)*

**Intent**: Add a nullable `first_reviewed_at` timestamp to `flashcards`. Nullable because no card has been reviewed yet at this point; S-04 will set it on the first review event.

**Contract**:

```sql
ALTER TABLE flashcards
  ADD COLUMN first_reviewed_at timestamptz;
```

No RLS change needed — the existing per-user policies already cover this column.

#### 2. Updated `Flashcard` interface

**File**: `src/types.ts`

**Intent**: Add `first_reviewed_at` to the `Flashcard` interface so it is typed throughout the app.

**Contract**: Add `first_reviewed_at: string | null;` to the `Flashcard` interface after `created_at`.

#### 3. New DTOs

**File**: `src/types.ts`

**Intent**: Declare the four shapes used by the deck API routes and the React island.

**Contract**: Append after the existing `SaveCurationResponseDTO`:

```typescript
// Response from GET /api/deck
export interface DeckListResponseDTO {
  cards: Flashcard[];
  total: number;
  page: number;
  pageSize: number;
}

// Input to POST /api/deck (manual card creation)
export interface CreateCardRequestDTO {
  front: string;
  back: string;
}

// Input to PATCH /api/deck/[id]
export interface UpdateCardRequestDTO {
  front: string;
  back: string;
}

// Response from POST /api/deck and PATCH /api/deck/[id]
export interface CardMutationResponseDTO {
  card: Flashcard;
}
```

#### 4. Update `Database` type

**File**: `src/types.ts`

**Intent**: Add `first_reviewed_at` to the `Database` type so Supabase client calls are typed correctly.

**Contract**: In `Database["public"]["Tables"]["flashcards"]`:
- `Row`: add `first_reviewed_at: string | null;`
- `Insert`: add `first_reviewed_at?: string | null;`
- `Update`: add `first_reviewed_at?: string | null;`

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Migration applies cleanly: `npx supabase db reset` or `npx supabase migration up`

#### Manual Verification

- Supabase Studio shows `first_reviewed_at` column on the `flashcards` table as nullable
- Existing rows have `first_reviewed_at = null`
- TypeScript build reports no type errors from the new field

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Deck API Routes

### Overview

Implement four routes that power all deck CRUD operations. All routes require auth (middleware guarantees this). PATCH and DELETE enforce the FR-007 lock rule.

### Changes Required

#### 1. List deck cards

**File**: `src/pages/api/deck/index.ts` *(new file)*

**Intent**: Return the authenticated user's accepted cards, paginated, ordered newest-first. Supports `?page=N` (default 1).

**Contract**:

```typescript
export const prerender = false;
export const GET: APIRoute = async (context) => { ... }
```

Query param: `page` — positive integer, default 1. Page size constant: `const PAGE_SIZE = 20`.

Supabase query:
```typescript
const from = (page - 1) * PAGE_SIZE;
const to = from + PAGE_SIZE - 1;
const { data, count, error } = await supabase
  .from("flashcards")
  .select("*", { count: "exact" })
  .eq("user_id", user.id)
  .eq("status", "accepted")
  .order("created_at", { ascending: false })
  .range(from, to);
```

Returns `200 DeckListResponseDTO` or `500 { error }`.

#### 2. Create card manually

**File**: `src/pages/api/deck/index.ts`

**Intent**: Create a new accepted flashcard with no generation source.

**Contract**:

```typescript
export const POST: APIRoute = async (context) => { ... }
```

Zod validation:
```typescript
z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
})
```

Supabase insert:
```typescript
supabase.from("flashcards").insert({
  user_id: user.id,
  generation_id: null,
  front,
  back,
  status: "accepted",
}).select().single()
```

Returns `201 CardMutationResponseDTO` on success, `400` on validation failure, `500` on DB error.

#### 3. Update card

**File**: `src/pages/api/deck/[id].ts` *(new file)*

**Intent**: Update front and back of an unlocked card. Blocks mutation if `first_reviewed_at` is set.

**Contract**:

```typescript
export const prerender = false;
export const PATCH: APIRoute = async (context) => { ... }
```

Route parameter: `context.params.id` — validate as UUID with Zod (`z.string().uuid()`), return 400 if invalid.

Lock-check logic (before any update):
1. Fetch `{ id, user_id, first_reviewed_at }` for the card — return 404 if absent.
2. Return `403 { error: "Card is locked after first review" }` if `first_reviewed_at` is non-null.
3. Run `.update({ front, back }).eq("id", id).eq("user_id", user.id).select().single()`.

Returns `200 CardMutationResponseDTO` on success.

#### 4. Delete card

**File**: `src/pages/api/deck/[id].ts`

**Intent**: Hard-delete an unlocked card. Blocks deletion if `first_reviewed_at` is set.

**Contract**:

```typescript
export const DELETE: APIRoute = async (context) => { ... }
```

Same lock-check logic as PATCH (fetch first, 404 if absent, 403 if locked), then `.delete().eq("id", id).eq("user_id", user.id)`.

Returns `new Response(null, { status: 204 })` on success — do not use the `json()` helper here, which always attaches a body; HTTP 204 must have no body.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- `GET /api/deck` (authed, no cards) → `200 { cards: [], total: 0, page: 1, pageSize: 20 }`
- `POST /api/deck` with `{ front: "Q", back: "A" }` → `201 { card: { id, front, back, status: "accepted", generation_id: null, first_reviewed_at: null } }`; row in Supabase Studio
- `POST /api/deck` with empty `front` → `400`
- `PATCH /api/deck/[id]` for a valid card → `200` with updated content
- `PATCH /api/deck/[id]` for a card with `first_reviewed_at` set → `403 { error: "Card is locked after first review" }`
- `DELETE /api/deck/[id]` for an unlocked card → `204`; row gone in Supabase Studio
- `DELETE /api/deck/[id]` for a locked card → `403`
- Unauthenticated request to any route → `401` (middleware)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Deck Page & React Island

### Overview

Install the shadcn Dialog component, create the deck page, and build the two React components — `DeckManager` (list + pagination + delete confirm) and `CardModal` (create/edit modal).

### Changes Required

#### 0. Install Dialog component

**Intent**: Install the shadcn Dialog component so `CardModal` can use it.

**Contract**: Run `npx shadcn@latest add dialog` from the project root. Confirm `src/components/ui/dialog.tsx` is created.

#### 1. Deck page

**File**: `src/pages/deck.astro` *(new file)*

**Intent**: SSR page that mounts the `DeckManager` React island. Follows the `generate.astro` pattern.

**Contract**: `const { user } = Astro.locals;`, wrap with `<Layout title="My Deck">`, render `<DeckManager client:load />`. No server-side data fetching — the island handles all data via API calls.

#### 2. DeckManager React island

**File**: `src/components/deck/DeckManager.tsx` *(new file)*

**Intent**: Main interactive island for the deck page. Manages card list, pagination, modal open/close, and delete confirmation.

**Contract**:

State:
- `cards: Flashcard[]` — current page's cards
- `total: number` — total accepted cards
- `page: number` — current page (default 1)
- `refetchKey: number` — default 0; increment to force a re-fetch without changing page
- `isLoading: boolean`
- `error: string | null`
- `modalState: { open: false } | { open: true; mode: "create" } | { open: true; mode: "edit"; card: Flashcard }`
- `deleteTarget: Flashcard | null` — card pending deletion confirmation

`PAGE_SIZE = 20` constant.

Data fetch: `useEffect` keyed on `[page, refetchKey]`; calls `GET /api/deck?page=${page}`, populates `cards` and `total`. The create/edit/delete success handlers call `setRefetchKey(k => k + 1)` to trigger a re-fetch on the current page without requiring a page change.

After delete: if `cards.length === 1` (last card on the page) and `page > 1`, decrement `page` instead of incrementing `refetchKey` — the page change itself triggers the re-fetch.

Render structure:
- Page heading "My Deck" with a total count badge (`{total} cards`)
- "Add Card" button (opens modal in create mode)
- Loading skeleton / error state when applicable
- `<ul>` of card items — each item shows:
  - Front text (truncated at 1 line)
  - Back text (truncated at 2 lines)
  - Lock badge (`🔒 Locked`) when `first_reviewed_at` is non-null
  - Edit button (disabled + `title="Locked after first review"` when locked)
  - Delete button (disabled when locked)
- Pagination controls: `< Previous` / `Next >` buttons + `Page N of M` label, disabled at boundaries
- Delete confirmation section: when `deleteTarget` is non-null, show an inline confirm prompt (`"Delete this card? This cannot be undone."` + Confirm / Cancel buttons) — rendered below the card list, not as a separate modal
- CardModal must be conditionally rendered as `{modalState.open && <CardModal ... />}` to ensure `useState` re-initializes with fresh values from the current card on each open; never render CardModal always-mounted and toggle only the Dialog's `open` prop

Card visual treatment using `cn()`:
- Default: `border-white/10 bg-white/5`
- Locked: `border-yellow-500/20 bg-yellow-900/10`

#### 3. CardModal component

**File**: `src/components/deck/CardModal.tsx` *(new file)*

**Intent**: Reusable Dialog modal for creating and editing flashcards. Shared between create and edit flows.

**Contract**:

Props:
```typescript
interface CardModalProps {
  mode: "create" | "edit";
  card?: Flashcard;       // provided when mode === "edit"
  onSave: (card: Flashcard) => void;
  onClose: () => void;
}
```

State:
- `front: string` — initialized from `card.front` or `""`
- `back: string` — initialized from `card.back` or `""`
- `isSaving: boolean`
- `saveError: string | null`

On submit:
- Create: `POST /api/deck { front, back }` → on success, call `onSave(card)` and `onClose()`
- Edit: `PATCH /api/deck/${card.id} { front, back }` → on success, call `onSave(updatedCard)` and `onClose()`

Validation: `front.trim().length > 0 && back.trim().length > 0` — show inline error if not.

Dialog title: "Add Flashcard" (create) or "Edit Flashcard" (edit).

Uses `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` from `@/components/ui/dialog`. Front and back are raw `<textarea>` elements styled with Tailwind, matching the aesthetic in `CurationPanel.tsx`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Visiting `/deck` while logged out → redirects to `/auth/signin?returnTo=%2Fdeck`
- Visiting `/deck` while logged in with 0 cards → empty state with "Add Card" button
- Clicking "Add Card" → modal opens with blank fields; submitting creates a card; card appears in the list
- Clicking Edit on an unlocked card → modal opens with pre-filled content; saving updates card in list
- Clicking Delete → confirm section appears; confirming removes the card from the list
- Pagination: create 21+ cards; page 1 shows 20; Next loads page 2 with remaining cards; Previous returns to page 1
- Locked card (set `first_reviewed_at` manually in Supabase Studio): Edit and Delete buttons are disabled; lock badge is visible
- Save error (simulate via DevTools network block): modal shows inline error, stays open

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Navigation Wiring

### Overview

Add "My Deck" to the Topbar and add a deck summary card on the dashboard, making the new page discoverable.

### Changes Required

#### 1. Topbar link

**File**: `src/components/Topbar.astro`

**Intent**: Add a "My Deck" link alongside the "Dashboard" link for authenticated users.

**Contract**: Inside the `user ? (...)` branch, add:
```astro
<a href="/deck" class="text-purple-300 transition-colors hover:text-purple-100 hover:underline">
  My Deck
</a>
```
Place it between "Dashboard" and "Sign out".

#### 2. Dashboard deck summary card

**File**: `src/pages/dashboard.astro`

**Intent**: Surface a visible entry point to the deck from the dashboard.

**Contract**: Add a new card below the existing welcome card:

```astro
<a
  href="/deck"
  class="block rounded-2xl border border-white/10 bg-white/10 p-6 text-center text-white backdrop-blur-xl transition-colors hover:bg-white/15"
>
  <h2 class="mb-1 text-lg font-semibold">My Deck</h2>
  <p class="text-sm text-blue-100/60">Browse, create, edit and delete your flashcards</p>
</a>
```

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Logged-in: "My Deck" link visible in Topbar on every page; clicking navigates to `/deck`
- Dashboard shows the deck summary card below the welcome card; clicking links to `/deck`
- Logged-out: no "My Deck" link in Topbar

**Implementation Note**: After completing this phase, run the full end-to-end test: create a card from `/deck`, confirm it persists across page reload, lock it via Supabase Studio, confirm UI and API lock enforcement.

---

## Testing Strategy

### Manual Testing Steps

1. Start dev server: `npm run dev` (with `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` in `.dev.vars`)
2. Run `npx supabase db reset` to apply the new migration locally; confirm `first_reviewed_at` column present
3. Sign in as a test user; navigate to `/deck` via Topbar
4. Verify empty state renders correctly
5. Add 3 cards via the modal; verify they appear in the list newest-first
6. Edit one card — change the front text; verify the change persists after page reload
7. Delete one card — confirm prompt appears; confirm deletion; verify 2 cards remain
8. Create 21 cards total; verify page 1 shows 20, page 2 shows 1; navigate back and forth
9. In Supabase Studio, set `first_reviewed_at = now()` on one card
10. Reload `/deck`; verify that card shows the lock badge; Edit and Delete buttons are disabled
11. Make a direct `PATCH /api/deck/[locked-id]` call with auth cookie — verify `403 { error: "Card is locked after first review" }`
12. Make a direct `DELETE /api/deck/[locked-id]` call — verify `403`
13. Verify "My Deck" link in Topbar; verify dashboard deck card links correctly

## Performance Considerations

Pagination cap at 20 cards per page keeps the `flashcards` SELECT payload small even as decks grow. The `created_at DESC` sort uses the implicit index on `created_at` (added when the table was created with `DEFAULT now()`). No caching needed at MVP scale.

## Migration Notes

`first_reviewed_at` is additive and nullable — safe to apply without data backfill. Existing rows automatically have `first_reviewed_at = null`, which means all current cards are unlocked at migration time. `npx supabase migration up` applies it in production before deploying the new Worker.

## References

- Roadmap: `context/foundation/roadmap.md` — S-03 section
- PRD: `context/foundation/prd.md` — FR-006, FR-007
- Prerequisite plan: `context/changes/atomic-save-to-deck/plan.md`
- Schema: `supabase/migrations/20260606000000_create_flashcards.sql`
- Shared types: `src/types.ts`
- API utils: `src/lib/api-utils.ts`
- Supabase client: `src/lib/supabase.ts`
- Generation form: `src/components/generation/CurationPanel.tsx`
- Generate page pattern: `src/pages/generate.astro`
- Dashboard page: `src/pages/dashboard.astro`
- Topbar: `src/components/Topbar.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema Migration & Types

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`
- [ ] 1.3 Migration applies cleanly: `npx supabase migration up`

#### Manual

- [ ] 1.4 `first_reviewed_at` column visible in Supabase Studio as nullable
- [ ] 1.5 Existing rows have `first_reviewed_at = null`
- [ ] 1.6 TypeScript build reports no type errors from the new field

### Phase 2: Deck API Routes

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 `GET /api/deck` (no cards) → `200 { cards: [], total: 0 }`
- [ ] 2.4 `POST /api/deck` valid → `201` with new card; row in Supabase Studio
- [ ] 2.5 `POST /api/deck` empty front → `400`
- [ ] 2.6 `PATCH /api/deck/[id]` unlocked → `200` with updated content
- [ ] 2.7 `PATCH /api/deck/[id]` locked → `403`
- [ ] 2.8 `DELETE /api/deck/[id]` unlocked → `204`; row deleted
- [ ] 2.9 `DELETE /api/deck/[id]` locked → `403`
- [ ] 2.10 Unauthenticated request → `401`

### Phase 3: Deck Page & React Island

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 Logged-out visit to `/deck` → redirect to sign-in with `returnTo`
- [ ] 3.4 Empty state renders with "Add Card" button
- [ ] 3.5 Create card via modal → appears in list
- [ ] 3.6 Edit card via modal → change persists after reload
- [ ] 3.7 Delete card with confirm → card removed from list
- [ ] 3.8 Pagination: 21+ cards → page 1 shows 20; Next/Previous works
- [ ] 3.9 Locked card shows lock badge; Edit/Delete disabled
- [ ] 3.10 Save error modal shows inline error and stays open

### Phase 4: Navigation Wiring

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 "My Deck" link in Topbar for logged-in users; absent when logged out
- [ ] 4.4 Dashboard deck summary card links to `/deck`
- [ ] 4.5 Full end-to-end: create card → lock via Supabase Studio → verify lock enforcement in UI and API
