# Deck Edit & Delete (S-03) — Plan Brief

> Full plan: `context/changes/deck-edit-delete/plan.md`

## What & Why

Build the deck management layer for 10xCards: a `/deck` page where users can browse their accepted flashcards, manually create new cards, edit unlocked ones, and delete them with confirmation. This slice fulfills FR-006 (manual card creation) and FR-007 (edit/delete with lock-after-first-review), completing the core CRUD loop that sits between AI generation (S-02) and study sessions (S-04).

## Starting Point

S-01 and S-02 are fully complete. The `flashcards` table exists with RLS in place, and `status='accepted'` cards form the user's deck. There is no deck-browsing page, no CRUD API routes for cards, no `first_reviewed_at` column, and no product navigation links beyond "Dashboard".

## Desired End State

A logged-in user can navigate to `/deck` from the Topbar or the dashboard, see their accepted cards paginated 20 per page, create cards via a modal, edit any unlocked card, and delete with confirmation. Cards that have been reviewed once display a lock badge; their Edit/Delete controls are disabled in the UI and blocked at the API with a 403. S-04 can populate `first_reviewed_at` on the first review without a follow-up migration.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Deck page location | New `/deck` page | Clean separation from `/dashboard`; easy to link from nav and future features |
| Card visibility | Accepted cards only | Drafts are pre-curation; deck = accepted cards only (consistent with S-02 mental model) |
| Create/edit UX | Shared modal (shadcn Dialog) | Consistent UX, no nav context loss, follows React island pattern from S-02 |
| Lock enforcement | Both UI and API | Defense in depth — protects SR data integrity even if the API is called directly |
| Delete confirmation | Inline confirm section below the list | Prevents accidental hard-delete without a second full modal |
| `first_reviewed_at` timing | Add now in S-03 | Lock rule requires this field; S-04 only needs to write to it, not create it |
| Pagination | 20 cards/page with prev/next | Simple offset query, consistent MVP scale |
| Navigation | Topbar + dashboard summary card | Reachable from every page and from the post-generation dashboard landing |

## Scope

**In scope:**
- New migration: `first_reviewed_at timestamptz NULL` on `flashcards`
- 4 API routes: `GET /api/deck`, `POST /api/deck`, `PATCH /api/deck/[id]`, `DELETE /api/deck/[id]`
- `/deck` SSR page + `DeckManager.tsx` island + `CardModal.tsx` modal
- `Topbar.astro` "My Deck" link + dashboard deck summary card
- Install `shadcn dialog` component

**Out of scope:**
- Draft card visibility on the deck page
- Soft-delete / undo
- Bulk operations
- Deck sorting or filtering
- Populating `first_reviewed_at` (S-04 responsibility)
- Automated tests

## Architecture / Approach

All mutable deck state lives in the `DeckManager` React island; the `/deck` Astro page is a thin SSR shell (mirrors the `/generate` pattern). The island fetches from four new API routes, which follow the established thin-handler pattern: Zod validation → auth check → Supabase operation → `json()` response. The lock rule is enforced by reading `first_reviewed_at` from the DB before any PATCH/DELETE mutation, returning 403 if set. A sibling `CardModal.tsx` handles both create and edit via a single Dialog component.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema Migration & Types | `first_reviewed_at` column + updated TS types + 4 new DTOs | Must apply before any code references the field |
| 2. Deck API Routes | `GET /api/deck` (list+pagination), `POST` (create), `PATCH`/`DELETE` (with lock check) | Lock check logic must read the row before mutating to avoid TOCTOU |
| 3. Deck Page & React Island | `/deck` page, `DeckManager`, `CardModal` (with Dialog) | Dialog must be installed (`npx shadcn@latest add dialog`) before writing CardModal |
| 4. Navigation Wiring | "My Deck" in Topbar + dashboard deck card | Low risk; pure Astro template changes |

**Prerequisites:** S-01 and S-02 fully implemented (confirmed: all Progress checkboxes checked). Local Supabase running for migration testing.

**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- `first_reviewed_at` will never be set to a non-null value by anything in S-03 itself — it is always populated by S-04. If S-03 is deployed before S-04, all cards remain unlocked (correct behavior).
- shadcn Dialog install adds `@radix-ui/react-dialog` — assumed compatible with the current Radix version already in `package.json` (other Radix primitives are used by the Button component).
- Pagination uses `count: "exact"` in Supabase, which adds a `Prefer: count=exact` header. For MVP card volumes this is fine; at very high counts a cached approximate count would be preferable.

## Success Criteria (Summary)

- User can create, edit, and delete accepted flashcards from `/deck`
- Cards with `first_reviewed_at` set cannot be mutated from UI or API
- "My Deck" is reachable from Topbar and dashboard
