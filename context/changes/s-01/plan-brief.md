# AI Card Generation (S-01) — Plan Brief

> Full plan: `context/changes/s-01/plan.md`

## What & Why

Build the first product slice of 10xCards: a gated page where a logged-in user pastes study text and receives AI-generated draft flashcards persisted to the database. This delivers the core value proposition — shrinking the source → draft-card pipeline — and is the foundation on which S-02 (curation) and all downstream slices depend.

## Starting Point

F-01 is fully implemented: the negative allow-list middleware automatically protects any route not in `PUBLIC_ROUTES`, so `/generate` and `/api/generate` are gated without any middleware change. There is no product DB schema, no `src/types.ts`, and no `OPENROUTER_API_KEY` in the project yet.

## Desired End State

A logged-in user visits `/generate`, pastes up to 10,000 characters of study material, picks a card count (5 / 10 / 15), and clicks "Generate." After a ~3–8 s wait (spinner), a read-only list of draft flashcard pairs (front / back) appears below the form — all saved to Supabase and ready for S-02 curation. The missing-config banner alerts developers when the OpenRouter key is absent.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| AI model | `openai/gpt-4o-mini` via OpenRouter | Best cost / quality ratio for structured extraction at MVP scale | Plan |
| Response format | JSON mode (`response_format: json_object`) | Zero parsing ambiguity; validates with Zod; most reliable structured output | Plan |
| DB schema | Flat `flashcards` + `generations` (no decks) | Minimal schema for this slice; decks introduced later; `generations` avoids duplicating source text per card | Plan |
| Latency UX | Spinner + disabled button | Sufficient for Workers Standard (30 s CPU); SSE would add significant complexity for no MVP gain | Plan |
| Generation count | User-selectable: 5 / 10 / 15 (default 10) | Gives control without open-ended input; matches what users requested | Plan |
| Text input limits | 50–10,000 characters | Covers a dense paragraph through a ~3-page article; fits comfortably in gpt-4o-mini context | Plan |
| Draft display | Same page, cards appear below the form | Zero extra navigation; simplest React state management | Plan |
| S-01 scope boundary | Read-only draft list only | Clean slice; accept / edit / discard is S-02 scope | Plan |

## Scope

**In scope:**
- `OPENROUTER_API_KEY` env declaration + missing-config banner
- Supabase migration: `generations` + `flashcards` tables with RLS
- `src/types.ts` — `Flashcard`, `Generation`, `FlashcardStatus`, DTOs
- `src/lib/services/generation.ts` — OpenRouter call, JSON mode, Zod validation
- `POST /api/generate` — validate, call service, persist, return JSON
- `src/pages/generate.astro` — SSR page
- `src/components/generation/GenerateForm.tsx` — textarea, count selector, loading state, read-only card list

**Out of scope:**
- Accept / edit / discard actions (S-02)
- Decks table (future)
- SSE streaming
- Rate limiting
- Past-generation history

## Architecture / Approach

The React island (`GenerateForm`) calls `POST /api/generate` via `fetch` with a JSON body. The API route validates with Zod, calls `generateCards()` in the service layer (single `fetch` to OpenRouter), and performs two Supabase inserts: one row in `generations`, N rows in `flashcards` (batch). The route returns the saved cards; the island renders them as read-only front/back pairs. The middleware (F-01) handles auth gating transparently.

```
Browser (GenerateForm)
  └─ POST /api/generate (JSON body)
       ├─ Zod validation
       ├─ generation.ts → OpenRouter (gpt-4o-mini, JSON mode)
       ├─ INSERT generations (1 row)
       ├─ INSERT flashcards (N rows, batch)
       └─ 200 { generationId, cards[] }
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Env & Config | `OPENROUTER_API_KEY` in env schema + banner | Forgetting `optional: true` breaks builds without the key |
| 2. DB & Types | `generations` + `flashcards` schema, `src/types.ts` | Missing RLS policy leaves user data unprotected |
| 3. Generation Service | OpenRouter call + Zod-validated response | JSON mode requires "json" in system prompt or the API returns an error |
| 4. API Route | `POST /api/generate` end-to-end | Partial insert if flashcard batch fails after generation row succeeds |
| 5. Page & UI | `/generate` page + `GenerateForm` island | Loading state must prevent double-submit; textarea must be disabled during generation |

**Prerequisites:** F-01 (`gate-product-routes`) — already complete. Local Supabase running (`npx supabase start`) for migration testing.

**Estimated effort:** ~2–3 sessions across 5 phases

## Open Risks & Assumptions

- `gpt-4o-mini` JSON mode is assumed reliable for structured extraction of study material; very dense or ambiguous text may produce fewer-than-requested cards (the service trims to `count` but does not pad)
- `OPENROUTER_API_KEY` must be added as a Workers Secret (`wrangler secret put`) before first production deployment — easy to miss
- No transaction wrapping: if the `flashcards` batch INSERT fails after the `generations` INSERT succeeds, a generation row exists with no cards; S-02 must handle empty-card generations gracefully

## Success Criteria (Summary)

- Logged-in user can paste text, click generate, and see N draft cards on the same page within 10 s
- Cards are visible in Supabase Studio with `status = 'draft'` and the correct `generation_id`
- Logged-out visit to `/generate` redirects to sign-in and returns to `/generate` after login
