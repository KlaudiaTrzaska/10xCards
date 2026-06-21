---
date: 2026-06-21T17:34:00+02:00
researcher: AI (Sonnet 4.6)
git_commit: cf29a13ffd94e937d0ee7952a46476fb415f0897
branch: cursor/add-test-plan
repository: KlaudiaTrzaska/10xCards
topic: "Generation & deck flow integration — curation → save-deck → deck CRUD call chain"
tags: [research, testing, curation, save-deck, deck-crud, integration, phase-2]
status: complete
last_updated: 2026-06-21
last_updated_by: AI (Sonnet 4.6)
---

# Research: Generation & Deck Flow Integration (Phase 2)

**Date**: 2026-06-21T17:34:00+02:00
**Researcher**: AI (Sonnet 4.6)
**Git Commit**: `cf29a13ffd94e937d0ee7952a46476fb415f0897`
**Branch**: `cursor/add-test-plan`
**Repository**: KlaudiaTrzaska/10xCards

## Research Question

What is the complete curation → save-deck → deck CRUD call chain, and what must Phase 2 integration tests cover to protect against Risks #2 and #5 from the test plan?

Focus: curation decision staging, save-deck atomicity (or lack thereof), deck CRUD API contracts, and patterns inherited from Phase 1.

## Summary

The generation → curation → save flow is a two-stage pipeline: `POST /api/generate` creates draft `flashcards` rows, `CurationPanel` stages per-card decisions in a React `Map`, then `POST /api/save-deck` commits them via three sequential Supabase mutations. **There is no Postgres transaction** — partial commits are possible if a later step fails.

A "deck" is not a separate table: it is all `flashcards` with `status = 'accepted'` for the current user. Post-save CRUD (`GET/POST /api/deck`, `PATCH/DELETE /api/deck/[id]`) operates on these accepted rows.

**No tests exist for any of these paths.** Phase 2 must write integration tests for `save-deck` and deck CRUD following the `makeCtx` + `vi.mock("@/lib/supabase")` pattern established in Phase 1.

---

## Detailed Findings

### 1. Curation Flow — Decision Staging

**Files:**
- [`src/components/generation/CurationPanel.tsx`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/components/generation/CurationPanel.tsx)
- [`src/components/generation/GenerateForm.tsx`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/components/generation/GenerateForm.tsx)

**State model.** `CurationPanel` holds all decision state locally in a `Map<string, CardDecision>` (lines 19-21). The local union type (lines 6-10) is:

```ts
type CardDecision =
  | { action: "accepted" }
  | { action: "discarded" }
  | { action: "editing"; editFront: string; editBack: string }
  | { action: "edited"; editFront: string; editBack: string };
```

Only `edited` and `accepted` entries count toward the save payload. `editing` is transient; `discarded` entries are hard-DELETEd.

**Derived arrays for save payload** (lines 35-53):
- `acceptedIds` — entries where `action === "accepted"`
- `editedCards` — entries where `action === "edited"`, mapped to `{ id, front, back }`
- `discardedIds` — entries where `action === "discarded"`
- `savedCount = acceptedIds.length + editedCards.length` (gate for Save button)

**Inline edit confirm** (lines 245-257): transitions `editing` → `edited` by copying `displayFront`/`displayBack` — **no `.trim()` and no empty-field check**. This is a known gap (see `lessons.md:40-45`). Whitespace-only strings pass the server-side zod `min(1)` check because `" ".length >= 1`.

**Submission is internal.** The parent (`GenerateForm`) only supplies `cards`, `generationId`, and `onReset`. All `fetch("/api/save-deck")` calls live inside `CurationPanel.handleSave()` (lines 95-124). After a successful save, the component calls `onReset()` then hard-navigates to `/deck?saved=${data.savedCount}`.

**Bulk actions** (S-06, `ux-improvements`) only populate the existing `decisions` Map — the save contract is unchanged.

---

### 2. Save-Deck API — Contract and Atomicity

**File:** [`src/pages/api/save-deck.ts`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/pages/api/save-deck.ts)

**Route:** `POST /api/save-deck` — auth required (`context.locals.user`), returns 401 if missing.

**Zod schema** (lines 9-24):
```ts
const RequestSchema = z.object({
  generationId: z.uuid(),
  accepted:  z.array(z.uuid()),
  edited:    z.array(z.object({
    id:    z.uuid(),
    front: z.string().min(1).max(1000),
    back:  z.string().min(1).max(1000),
  })),
  discarded: z.array(z.uuid()),
}).refine(d => d.accepted.length + d.edited.length > 0, {
  message: "At least one card must be accepted or edited",
});
```

**Three sequential DB mutations** (no transaction, no RPC):

| Step | Operation | Lines | Rollback on failure? |
|------|-----------|-------|---------------------|
| 1 | `DELETE flashcards WHERE id IN discarded AND user_id = ? AND generation_id = ?` | 51–62 | **No** |
| 2 | `UPDATE flashcards SET status='accepted' WHERE id IN accepted AND user_id = ? AND generation_id = ?` | 64–75 | **No** |
| 3 | `Promise.all(edited.map(card => UPDATE flashcards SET status='accepted', front, back WHERE id=? AND user_id=? AND generation_id=?))` | 77–93 | **No** |

If step 3 fails after step 1 and 2 commit, the deck is in a **partially-saved state** with no automatic recovery. The client preserves `decisions` so the user can retry — and retry is idempotent (DELETE of absent row = no-op; UPDATE of already-accepted row = no-op).

**Known gaps (from impl-review, `atomic-save-to-deck`):**
- `savedCount` (line 95) is computed from **input array lengths**, not affected row counts. If submitted IDs don't match rows owned by the user, the count is over-reported (impl-review F1).
- No DB-level transaction. `atomic-save-to-deck/reviews/impl-review.md:37-52` documents Fix B (Postgres RPC) as the path to true atomicity — not implemented for MVP.

---

### 3. Deck CRUD APIs

#### `GET/POST /api/deck` — [`src/pages/api/deck/index.ts`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/pages/api/deck/index.ts)

| Method | Request | Response | Notes |
|--------|---------|----------|-------|
| `GET` | `?page=N` (int ≥ 1, default 1) | `DeckListResponseDTO` — `{ cards, total, page, pageSize }` | `PAGE_SIZE = 20`, ordered `created_at DESC`, `status = 'accepted'` only |
| `POST` | `{ front: min(1).max(1000), back: min(1).max(1000) }` | `CardMutationResponseDTO` — `{ card }`, 201 | Manual create; `generation_id: null` |

#### `PATCH/DELETE /api/deck/[id]` — [`src/pages/api/deck/[id].ts`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/pages/api/deck/%5Bid%5D.ts)

| Method | Request | Response | Notes |
|--------|---------|----------|-------|
| `PATCH` | `{ front, back }` | `CardMutationResponseDTO` — `{ card }`, 200 | 403 if `first_reviewed_at !== null` (card locked after first review) |
| `DELETE` | (no body) | `204 No Content` | Same lock rule applies |

Both methods scope by `user_id = auth.uid()` and `status = 'accepted'` at fetch time. Route uses a shared `getCardForMutation(id, user)` helper that returns `{ ok, card?, response? }`.

**No single-card GET endpoint** exists.

---

### 4. Shared Types and Zod Schemas

**File:** [`src/types.ts`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/src/types.ts)

| Type | Lines | Role |
|------|-------|------|
| `FlashcardStatus` | 1 | `"draft" \| "accepted"` |
| `Flashcard` | 12-31 | Full card entity (includes FSRS fields, `first_reviewed_at`, `generation_id`) |
| `SaveCurationRequestDTO` | 46-51 | POST `/api/save-deck` input |
| `SaveCurationResponseDTO` | 54-56 | POST `/api/save-deck` output |
| `DeckListResponseDTO` | 59-64 | GET `/api/deck` output |
| `CreateCardRequestDTO` | 67-70 | POST `/api/deck` input |
| `UpdateCardRequestDTO` | 73-76 | PATCH `/api/deck/[id]` input |
| `CardMutationResponseDTO` | 79-81 | POST/PATCH card output |

**Important:** `SaveCurationRequestDTO` is defined in `src/types.ts` but **not imported in `CurationPanel.tsx`** — the component builds the payload inline. `CardDecision` (UI-local union) is not exported from `src/types.ts`.

**No `Deck` interface and no `CurationDecision` type exist** — "deck" is a runtime concept, not a schema entity.

---

### 5. Data Schema

**File:** [`supabase/migrations/20260606000000_create_flashcards.sql`](https://github.com/KlaudiaTrzaska/10xCards/blob/cf29a13ffd94e937d0ee7952a46476fb415f0897/supabase/migrations/20260606000000_create_flashcards.sql)

```sql
CREATE TABLE flashcards (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id uuid    REFERENCES generations(id) ON DELETE CASCADE,
  front         text    NOT NULL,
  back          text    NOT NULL,
  status        text    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'accepted')),
  created_at    timestamptz DEFAULT now() NOT NULL
);
```

Additional columns added by later migrations: `first_reviewed_at` (timestamptz), FSRS columns (`fsrs_due`, `fsrs_stability`, `fsrs_difficulty`, `fsrs_elapsed_days`, `fsrs_scheduled_days`, `fsrs_reps`, `fsrs_lapses`, `fsrs_state`).

**No `decks` table** — a deck is always a query: `SELECT * FROM flashcards WHERE user_id = auth.uid() AND status = 'accepted'`.

RLS ensures each user can only read/modify their own rows. All DB mutations in `save-deck.ts` additionally scope by `generation_id` for defense-in-depth (enforced after plan-review F2 catch).

---

### 6. Post-Save List Flow

1. `CurationPanel.handleSave()` → `POST /api/save-deck` → success
2. `window.location.href = "/deck?saved=${data.savedCount}"` — hard nav (`CurationPanel.tsx:116-117`)
3. `deck.astro` reads `?saved=` query param and renders a success banner
4. `DeckManager.tsx:33` issues `GET /api/deck?page=${page}` → `DeckListResponseDTO`
5. Per-card edit/delete from `DeckManager` calls `PATCH /api/deck/{id}` or `DELETE /api/deck/{id}`

---

### 7. Existing Test Coverage

| Path | Tests | Coverage |
|------|-------|----------|
| `src/lib/services/__tests__/generation.test.ts` | U1–U11 | `generateCards()` unit tests |
| `src/pages/api/__tests__/generate.test.ts` | I1–I6 | `POST /api/generate` integration |
| `src/pages/api/__tests__/save-deck.test.ts` | **none** | **0%** |
| `src/pages/api/__tests__/deck/` | **none** | **0%** |

---

## Code References

- `src/components/generation/CurationPanel.tsx:6-10` — `CardDecision` local union type
- `src/components/generation/CurationPanel.tsx:19-21` — `decisions` Map state, `isSaving`, `saveError`
- `src/components/generation/CurationPanel.tsx:35-53` — derived arrays for save payload
- `src/components/generation/CurationPanel.tsx:95-124` — `handleSave()` — direct POST to `/api/save-deck`
- `src/components/generation/CurationPanel.tsx:245-257` — Confirm inline edit (no trim/validate)
- `src/pages/api/save-deck.ts:9-24` — Zod `RequestSchema`
- `src/pages/api/save-deck.ts:51-93` — three sequential DB mutations
- `src/pages/api/save-deck.ts:95-99` — `savedCount` from array lengths (not affected rows)
- `src/pages/api/deck/index.ts:11-14` — `CreateCardSchema`
- `src/pages/api/deck/index.ts:22-56` — `GET` handler with pagination
- `src/pages/api/deck/index.ts:58-101` — `POST` handler
- `src/pages/api/deck/[id].ts:9-13` — `IdSchema`, `UpdateCardSchema`
- `src/pages/api/deck/[id].ts:40-50` — lock check (`first_reviewed_at !== null` → 403)
- `src/types.ts:46-81` — all curation and deck DTOs

---

## Architecture Insights

**Deck = query, not entity.** There is no `decks` table. A user's deck is always `SELECT * FROM flashcards WHERE user_id = ? AND status = 'accepted'`. This simplifies writes (status flip = save) but means "delete a deck" is conceptual only.

**Two-stage persistence.** Generation persists cards as `draft` immediately. Curation only updates `status` and optionally `front`/`back`. The draft rows accumulate until curation saves or the user leaves.

**Sequential, not transactional, save.** The three mutations in `save-deck.ts` are each atomic at the SQL statement level but have no cross-statement transaction. Idempotent retry is the intended partial-save mitigation — not compensating rollback.

**`generationId` as the scoping key.** Every mutation in `save-deck` scopes by both `user_id` AND `generation_id`. This prevents a user from accepting another generation's draft cards by submitting foreign IDs — a security fix applied during plan review.

**No React testing.** Phase 1 explicitly deferred all React/DOM testing. Phase 2 targets API route integration tests only, not `CurationPanel` component tests. The null-guard bug in `GenerateForm` (deferred gap #4) is a candidate but not primary.

---

## Historical Context (from prior changes)

- `context/changes/atomic-save-to-deck/plan.md` — S-02 chose staged batch UX with idempotent sequential DB ops over Postgres RPC (explicitly rejected as "over-engineering for MVP"). Full payload contract and `generationId` wiring design live here.
- `context/changes/atomic-save-to-deck/reviews/impl-review.md` — Post-ship review: F1 (`savedCount` over-reports), F2 (not truly atomic — recommends Fix B: Postgres RPC), F3 (whitespace edits pass validation).
- `context/changes/atomic-save-to-deck/reviews/plan-review.md` — F2 catch: asymmetric `generation_id` scoping fixed before implementation (UPDATE accepted/edited now scoped by `generation_id`).
- `context/changes/deck-edit-delete/plan.md` — S-03 established deck CRUD API routes; deck as `status='accepted'` query confirmed; `first_reviewed_at` lock column added.
- `context/changes/ux-improvements/plan-brief.md` — S-06 bulk accept/discard: UI-only, save contract unchanged.
- `context/archive/2026-06-20-testing-bootstrap-generation-resilience/plan.md` — Phase 1 testing: established Vitest config, `makeCtx` helper, `vi.mock` patterns, `src/pages/api/__tests__/` location. Phase 2 extends this directly.
- `context/foundation/lessons.md:40-45` — "Trim and validate inline edit fields before staging curation saves" — whitespace-only edits can reach `/api/save-deck`.

---

## Related Research

- `context/archive/2026-06-20-testing-bootstrap-generation-resilience/research.md` — Phase 1 research: generation flow, `generateCards()` architecture, deferred gaps (including `GenerateForm` null-guard).

---

## Open Questions

1. **Partial-save test strategy for Risk #5.** The test plan says "Network/DB error mid-save → all-or-nothing (no partial deck)" and anti-pattern is "Mocking DB to always succeed." Since no Postgres RPC exists, the only way to test partial save is to mock the Supabase client to fail at step 2 or 3 and assert the 500 response — but the partial-committed state is invisible through mocks. Should Phase 2 tests document the current MVP behavior (non-atomic, retry-safe) rather than assert all-or-nothing? This needs a decision in the plan.

2. **Whitespace-only edit coverage.** The lesson (`lessons.md:40-45`) says Confirm does not trim. The Zod `min(1)` check would pass `" "`. Should Phase 2 tests surface this as a failing test that drives a code fix (fix-then-prove pattern), or treat it as out-of-scope since it was not fixed in Phase 1?

3. **`savedCount` accuracy.** The over-reporting issue (impl-review F1) is an existing known gap. Phase 2 can expose it with a test mocking Supabase to accept 0 rows but not necessarily fix it.

4. **`GenerateForm` null-guard.** The Phase 1 deferred gap (undefined `cards`/`generationId` on HTTP 200 crashes `CurationPanel`) is a React component issue — Phase 2 is integration-tests-only per the test plan. Confirm this stays deferred.

5. **Deck CRUD lock semantics.** `PATCH/DELETE /api/deck/[id]` returns 403 if `first_reviewed_at !== null`. Phase 2 integration tests for deck edit should cover both the locked and unlocked card paths.
