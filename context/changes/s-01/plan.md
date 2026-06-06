# AI Card Generation (S-01) — Implementation Plan

## Overview

Build the first product feature slice: a gated `/generate` page where a logged-in user pastes study text, selects how many cards to generate (5 / 10 / 15), triggers AI generation via OpenRouter (`openai/gpt-4o-mini`, JSON mode), and sees draft flashcards appear below the form on the same page — all persisted server-side. S-02 will add accept / edit / discard curation on top of this saved batch.

## Current State Analysis

F-01 is fully implemented — the negative allow-list middleware (`PUBLIC_ROUTES`) automatically protects any route outside `/auth`, `/api/auth`, `/sitemap`, and `/`. The new `/generate` page and `/api/generate` API route are protected without any middleware change.

No product DB schema exists. `src/types.ts` does not exist. `OPENROUTER_API_KEY` is not declared anywhere in the project. The only env variables in `astro.config.mjs` are `SUPABASE_URL` and `SUPABASE_KEY`.

### Key Discoveries

- `src/middleware.ts:4` — `PUBLIC_ROUTES` negative allow-list; `/generate` needs no middleware change
- `astro.config.mjs:20-25` — env schema uses `envField.string({ context: "server", access: "secret", optional: true })`; same pattern for `OPENROUTER_API_KEY`
- `src/lib/config-status.ts:1` — imports from `astro:env/server` and populates the missing-config banner; `OPENROUTER_API_KEY` should be registered here
- `src/pages/api/auth/signin.ts` — API route pattern: `export const POST: APIRoute`, `createClient`, return JSON or redirect; new route follows same shape
- `src/pages/dashboard.astro` — product page pattern: `const { user } = Astro.locals;`, wraps `<Layout>`, passes user context to React island
- `src/components/auth/SignInForm.tsx` — React island pattern: React state + `fetch`, no Next.js directives, hooks in `src/components/hooks/` if extracted
- `supabase/migrations/` exists and is empty — no product schema yet
- `wrangler.jsonc` — no `OPENROUTER_API_KEY` binding yet; must be added as a Workers Secret via `wrangler secret put`
- `.env.example` — `SUPABASE_URL=###` and `SUPABASE_KEY=###`; `OPENROUTER_API_KEY=###` must be appended

## Desired End State

After this change:

- A logged-in user visits `/generate`, sees a form with a textarea and a card-count selector (5 / 10 / 15, default 10).
- Submitting the form calls `POST /api/generate`, which validates input (50–10,000 chars, count enum), calls OpenRouter, inserts one row into `generations` and N rows into `flashcards` (status: `draft`), and returns the saved cards as JSON.
- The UI shows a spinner during the ~3–8 s wait, then renders the draft cards as read-only front/back pairs below the form.
- Missing `OPENROUTER_API_KEY` surfaces a banner in the layout (same pattern as missing Supabase config).
- `supabase/migrations/` contains one migration that creates both `generations` and `flashcards` with RLS policies.
- `src/types.ts` exports `Flashcard`, `Generation`, `FlashcardStatus`, and the two shared DTOs.

### Key Discoveries

- Workers CPU time is for computation only; OpenRouter I/O does not count. A single `fetch` call to OpenRouter is safe within Workers Standard limits.
- `response_format: { type: "json_object" }` requires the system prompt to explicitly mention JSON; otherwise `gpt-4o-mini` may return prose.
- `optional: true` on the env field means the build does not fail when the key is absent — the banner handles degraded UX gracefully.

## What We're NOT Doing

- Adding accept / edit / discard actions (S-02 scope)
- Introducing a `decks` table (no deck concept in this slice)
- Streaming card output via SSE (simple loading state is sufficient given Workers I/O constraints)
- Writing automated tests (no test runner is configured in the project)
- Adding pagination or history of past generations
- Protecting or rate-limiting the generate endpoint beyond auth (rate-limiting is post-MVP)
- Adding a `deck_id` FK to `flashcards` (will be added as a separate migration in S-03)

## Implementation Approach

Five phases in dependency order. Phase 1 (env) and Phase 2 (schema + types) can be worked in parallel, but Phase 3 (service) depends on both. Phase 4 (API route) depends on Phase 3. Phase 5 (UI) can begin in parallel with Phase 4 once the route contract is known.

The API route accepts a JSON body (not `multipart/form-data`) because the React island uses `fetch` with a loading state — there is no page-navigation form submit.

## Critical Implementation Details

**JSON mode system prompt requirement:** `gpt-4o-mini` with `response_format: { type: "json_object" }` will raise an error if the word "json" does not appear somewhere in the messages. The system prompt must explicitly say something like "Return a JSON object with a `cards` array."

**Batch INSERT for flashcards:** All N cards for a generation should be inserted in a single `supabase.from("flashcards").insert([...])` call, not in a loop. This avoids partial-save states if the Worker is interrupted mid-loop and keeps the round-trip count to one.

**`prerender = false` on API route:** CLAUDE.md requires all API routes to export `const prerender = false`. The existing auth routes omit this (they were written before the rule was in place); the new route must include it.

---

## Phase 1: Env & Config Foundation

### Overview

Declare `OPENROUTER_API_KEY` in the Astro env schema, add it to `.env.example` and the missing-config banner. After this phase the app builds cleanly without the key (optional) and surfaces a visible warning when it is absent.

### Changes Required

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` as a server-only secret so it is available via `import { OPENROUTER_API_KEY } from "astro:env/server"` and excluded from client bundles.

**Contract**: Add to the `env.schema` block alongside the existing Supabase keys:
```typescript
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

#### 2. Missing-config banner

**File**: `src/lib/config-status.ts`

**Intent**: Register `OPENROUTER_API_KEY` in the config-status list so the layout banner warns developers and operators when it is absent.

**Contract**: Import `OPENROUTER_API_KEY` from `astro:env/server` alongside `SUPABASE_URL` and `SUPABASE_KEY`. Add a second entry to `configStatuses`:
```typescript
{
  name: "OpenRouter",
  configured: Boolean(OPENROUTER_API_KEY),
  message: "OpenRouter API key is not configured — AI card generation is disabled.",
},
```

#### 3. Local dev env example

**File**: `.env.example`

**Intent**: Document the new required secret for developers setting up a local environment.

**Contract**: Append `OPENROUTER_API_KEY=###` as a third line.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- App starts without `OPENROUTER_API_KEY` set — banner appears in the layout warning about missing OpenRouter config
- App starts with `OPENROUTER_API_KEY` set — no OpenRouter banner

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Database Migration & Shared Types

### Overview

Create the `generations` and `flashcards` tables with RLS, and create `src/types.ts` with the TypeScript types that the service, API route, and UI share.

### Changes Required

#### 0. Install Zod

**Intent**: Add `zod` as a runtime dependency for input validation in the generation service (Phase 3) and API route (Phase 4).

**Contract**: Run `npm install zod` from the project root. Confirm `zod` appears in `package.json` `dependencies` before writing any service or route code that imports it.

#### 0b. Create migrations directory

**Intent**: `supabase/migrations/` does not exist yet — it must be created before the migration file can be placed inside it.

**Contract**: Run `mkdir -p supabase/migrations` from the project root.

#### 1. Supabase migration

**File**: `supabase/migrations/20260606000000_create_flashcards.sql`

**Intent**: Create two normalized tables — `generations` (one row per AI call, stores source text and metadata) and `flashcards` (N rows per generation, stores front/back and curation status). Separate tables avoid duplicating the source text across every card. Enable RLS with granular per-operation, per-role policies on both.

**Contract**:

```sql
-- generations: one row per AI call
CREATE TABLE generations (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_text     text        NOT NULL,
  card_count_requested smallint NOT NULL,
  model           text        NOT NULL,
  created_at      timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generations_insert_own"
  ON generations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "generations_select_own"
  ON generations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- flashcards: N rows per generation
CREATE TABLE flashcards (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id  uuid    REFERENCES generations(id) ON DELETE CASCADE,
  front          text    NOT NULL,
  back           text    NOT NULL,
  status         text    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'accepted')),
  created_at     timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flashcards_insert_own"
  ON flashcards FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "flashcards_select_own"
  ON flashcards FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "flashcards_update_own"
  ON flashcards FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "flashcards_delete_own"
  ON flashcards FOR DELETE TO authenticated
  USING (user_id = auth.uid());
```

#### 2. Shared TypeScript types

**File**: `src/types.ts` *(new file)*

**Intent**: Declare the `Generation` and `Flashcard` entity types (matching the DB schema) and two DTOs used across the service, API route, and UI component.

**Contract**:

```typescript
export type FlashcardStatus = "draft" | "accepted";

export interface Generation {
  id: string;
  user_id: string;
  source_text: string;
  card_count_requested: number;
  model: string;
  created_at: string;
}

export interface Flashcard {
  id: string;
  user_id: string;
  generation_id: string | null;
  front: string;
  back: string;
  status: FlashcardStatus;
  created_at: string;
}

// Input to POST /api/generate
export interface GenerateRequestDTO {
  sourceText: string;
  count: 5 | 10 | 15;
}

// Saved flashcard returned from POST /api/generate
export interface GenerateResponseDTO {
  generationId: string;
  cards: Flashcard[];
}
```

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Migration applies cleanly: `npx supabase db reset` (local) or `npx supabase migration up`

#### Manual Verification

- Supabase Studio (local) shows `generations` and `flashcards` tables with correct columns and RLS enabled
- Authenticated user can INSERT and SELECT from both tables; unauthenticated request is rejected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Generation Service

### Overview

Implement a pure function that calls OpenRouter with `gpt-4o-mini` in JSON mode and returns a validated array of `{ front, back }` pairs. No DB interaction here — the service is only responsible for the AI call and response parsing.

### Changes Required

#### 1. Generation service

**File**: `src/lib/services/generation.ts` *(new file)*

**Intent**: Encapsulate the OpenRouter API call so the API route stays thin. Accepts source text, requested count, and the API key; returns validated card candidates or throws a typed error the route can catch and translate into an HTTP 502.

**Contract**:

```typescript
export interface CardCandidate {
  front: string;
  back: string;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export async function generateCards(
  sourceText: string,
  count: 5 | 10 | 15,
  apiKey: string
): Promise<CardCandidate[]>
```

The function:
1. POSTs to `https://openrouter.ai/api/v1/chat/completions` with `model: "openai/gpt-4o-mini"`, `response_format: { type: "json_object" }`, and a system prompt that says: *"You are a flashcard generator. Given study material, generate exactly `{count}` flashcards as a JSON object with a `cards` array. Each card has `front` (question or concept) and `back` (answer or definition). Focus on key facts, definitions, and concepts."* The user message contains the source text. Include headers `Authorization: Bearer ${apiKey}` and `Content-Type: application/json`; omit `HTTP-Referer` for MVP (OpenRouter does not require it).
2. Throws `GenerationError` if the HTTP status is not 2xx.
3. Parses `response.choices[0].message.content` as JSON.
4. Validates with a Zod schema: `z.object({ cards: z.array(z.object({ front: z.string().min(1), back: z.string().min(1) })).min(1) })`.
5. Returns `parsed.cards` (trimmed to `count` if the model returns more).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- With a valid `OPENROUTER_API_KEY` in `.env` / `.dev.vars`, a direct `curl` call or a quick test script returns a valid array of `{ front, back }` objects for a sample input

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: API Route

### Overview

Implement `POST /api/generate` — the single server-side entry point for the generation flow. It validates input, calls the service, persists the generation and all cards atomically, and returns the saved batch as JSON.

### Changes Required

#### 1. Generate API route

**File**: `src/pages/api/generate.ts` *(new file)*

**Intent**: Thin API handler that wires together input validation, the generation service, and Supabase persistence. The route trusts that `context.locals.user` is non-null (middleware guarantees auth); it does not re-check auth.

**Contract**:

```typescript
export const prerender = false;
export const POST: APIRoute = async (context) => { ... }
```

Request body: `application/json` — `{ sourceText: string, count: 5 | 10 | 15 }`

Guard for missing API key (run before anything else):
```typescript
if (!OPENROUTER_API_KEY) {
  return new Response(JSON.stringify({ error: "Service unavailable — generation not configured" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}
```

Validation (Zod):
```typescript
z.object({
  sourceText: z.string().min(50).max(10_000),
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]),
})
```

Happy path:
Happy path:
1. Guard for missing `OPENROUTER_API_KEY` (see contract above) — return `503` if absent.
2. Parse JSON body; validate with Zod — return `400 { error: "..." }` on failure.
3. Get `user` from `context.locals.user`.
4. Call `generateCards(sourceText, count, OPENROUTER_API_KEY)` — return `502 { error: "Generation failed" }` on `GenerationError`.
5. Create Supabase client; INSERT one row into `generations`; INSERT all card candidates as a single batch into `flashcards` with `user_id`, `generation_id`, `status: "draft"` using `.insert([...]).select()` — the returned `data` array is the `Flashcard[]` to include in the response.
6. Return `200 { generationId, cards: [...] }` matching `GenerateResponseDTO`.

Error shape: `{ error: string }` for all non-2xx responses.

> **Partial-insert note**: if the `flashcards` batch INSERT fails after the `generations` INSERT succeeds, a `generations` row will persist with zero cards. No transaction wrapping is in place for MVP. S-02 must skip or surface empty generations rather than crashing on a missing card list.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- `curl -X POST http://localhost:4321/api/generate` without auth → `401 {"error":"Unauthorized"}` (handled by middleware)
- With auth cookie, valid body → `200` with `generationId` and array of cards; rows appear in Supabase Studio
- Body with `sourceText` under 50 chars → `400` with validation error
- Body with invalid `count` (e.g. `7`) → `400` with validation error
- Missing or invalid `OPENROUTER_API_KEY` → `502 {"error":"Generation failed"}`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Generate Page & UI

### Overview

Create the `src/pages/generate.astro` SSR page and the `GenerateForm` React island. The island owns the generation flow: textarea, count selector, loading state, error display, and the read-only draft card list.

### Changes Required

#### 1. Generate page

**File**: `src/pages/generate.astro` *(new file)*

**Intent**: SSR page that provides the outer layout and mounts the React island. Reads the authenticated user from `Astro.locals` for potential future use (e.g. passing email to the island).

**Contract**: Follow the `dashboard.astro` pattern — `const { user } = Astro.locals;`, wrap with `<Layout title="Generate Cards">`, render `<GenerateForm client:load />`.

#### 2. GenerateForm React island

**File**: `src/components/generation/GenerateForm.tsx` *(new file)*

**Intent**: Client-interactive component that drives the generation UX: textarea input, count picker, submit with loading state, and the resulting read-only draft card list.

**Contract**:

State: `sourceText: string` (default `""`), `count: 5 | 10 | 15` (default `10`), `isLoading: boolean` (default `false`), `error: string | null` (default `null`), `cards: Flashcard[] | null` (default `null`).

On submit:
1. `e.preventDefault()`. Client-side validate `sourceText` length (50–10,000) — show inline error if invalid.
2. Set `isLoading = true`, clear `error` and `cards`.
3. `fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceText, count }) })`.
4. On non-OK response: parse `{ error }` and set `error` state. On network error: set generic error message.
5. On success: set `cards` state from `response.cards`; do NOT reset the textarea (user may want to reference the input).
6. Set `isLoading = false`.

Render structure:
- `<form>` with `onSubmit`
- Textarea: `rows={8}`, placeholder, character counter (`{sourceText.length} / 10000`), disabled while loading
- Count selector: three `<button>` or `<label>/<input type="radio">` elements for 5 / 10 / 15; visually indicates selected value
- Submit button: disabled while `isLoading`; shows "Generating…" text while loading (follow the `SubmitButton` pattern from auth)
- Error section: renders `error` when non-null
- Card list section: when `cards` is non-null and non-empty, renders each card as a two-column (or stacked) panel with a "Front" label and "Back" label; cards are read-only (no buttons in S-01); includes a count heading "Generated N draft cards"

Use `cn()` from `@/lib/utils` for conditional class names. Match the visual style of the existing dashboard / auth pages (dark glass-morphism aesthetic with `bg-white/10`, `backdrop-blur`, `border-white/10`).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Visiting `/generate` while logged out → redirects to `/auth/signin?returnTo=%2Fgenerate`; after sign-in, lands on `/generate` ✓
- Visiting `/generate` while logged in → page loads with form
- Submitting with fewer than 50 chars → inline validation error, no API call
- Submitting with valid input → button shows "Generating…", request fires, spinner visible for ~3-8 s
- On success → draft cards appear below the form; count heading matches requested count
- On missing `OPENROUTER_API_KEY` → layout banner visible; form returns error on submit
- On OpenRouter error → user-visible error message appears below the form

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the full end-to-end flow works before closing this change.

---

## Testing Strategy

### Manual Testing Steps

1. Start dev server: `npm run dev` (with `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` set in `.dev.vars`)
2. Open incognito window → visit `http://localhost:4321/generate` → verify redirect to sign-in with `returnTo=%2Fgenerate` → sign in → verify landing on `/generate`
3. Paste ≥ 50 chars of text, select count 5 → submit → verify spinner → verify 5 cards appear
4. Check Supabase Studio: one row in `generations`, five rows in `flashcards` with `status = 'draft'`
5. Submit again with the same text → verify second generation appears (new `generationId`)
6. Remove `OPENROUTER_API_KEY` from `.dev.vars` and restart → verify banner + 502 error message on submit
7. Submit with 49-char text → verify client-side validation error, no network request in DevTools

## Performance Considerations

OpenRouter I/O (`~3-8 s`) does not count toward Workers CPU time. The only CPU-bound operations in the route are JSON parsing and Zod validation — well within the 30 ms CPU budget. No caching or batching is needed at MVP scale.

The batch INSERT (`supabase.from("flashcards").insert([...])`) keeps the Supabase round-trip count at two (one for `generations`, one for `flashcards`) regardless of card count.

## Migration Notes

The migration is additive only — no existing data is touched. `supabase db reset` applies it cleanly in a fresh local instance. In production, run `npx supabase migration up` before deploying the new Worker to ensure the schema is in place before the first request hits the API route.

## References

- Roadmap: `context/foundation/roadmap.md` — S-01 section
- Infrastructure: `context/foundation/infrastructure.md` — OpenRouter latency, CPU limits, Workers runtime warnings
- PRD: `context/foundation/prd.md` — FR-003, FR-004, US-01
- Prerequisite plan: `context/changes/gate-product-routes/plan.md`
- Middleware: `src/middleware.ts`
- Supabase client: `src/lib/supabase.ts`
- Env schema: `astro.config.mjs`
- Config banner: `src/lib/config-status.ts`
- Example API route: `src/pages/api/auth/signin.ts`
- Example React island: `src/components/auth/SignInForm.tsx`
- Example product page: `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Env & Config Foundation

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 55ace21
- [x] 1.2 Build passes: `npm run build` — 55ace21

#### Manual

- [x] 1.3 App starts without `OPENROUTER_API_KEY` — banner appears — 55ace21
- [x] 1.4 App starts with `OPENROUTER_API_KEY` — no OpenRouter banner — 55ace21

### Phase 2: Database Migration & Shared Types

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 2f15fd5
- [x] 2.2 Build passes: `npm run build` — 2f15fd5
- [x] 2.3 Migration applies cleanly: `npx supabase migration up` — 2f15fd5

#### Manual

- [x] 2.4 `generations` and `flashcards` tables visible in Supabase Studio with RLS enabled — 2f15fd5
- [x] 2.5 Authenticated INSERT and SELECT succeed; unauthenticated request rejected — 2f15fd5

### Phase 3: Generation Service

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [x] 3.3 Direct call to `generateCards` with valid API key returns `{ front, back }[]`

### Phase 4: API Route

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 Unauthenticated POST → `401`
- [ ] 4.4 Valid auth + valid body → `200`, rows in Supabase Studio
- [ ] 4.5 Body with `sourceText` < 50 chars → `400`
- [ ] 4.6 Body with invalid `count` → `400`
- [ ] 4.7 Missing API key → `502 {"error":"Generation failed"}`

### Phase 5: Generate Page & UI

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Build passes: `npm run build`

#### Manual

- [ ] 5.3 Logged-out visit to `/generate` → redirect to sign-in with `returnTo` → lands on `/generate` after sign-in
- [ ] 5.4 Logged-in: page loads with form
- [ ] 5.5 < 50 chars → client-side validation error, no network request
- [ ] 5.6 Valid input → spinner during generation → draft cards appear below form
- [ ] 5.7 Missing API key → layout banner visible + error on submit
- [ ] 5.8 OpenRouter error → user-visible error message
