<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Card Generation (S-01)

- **Plan**: `context/changes/s-01/plan.md`
- **Scope**: Phases 1-5 of 5
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 3 warnings 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

## Findings

### F1 — Flashcards can reference another user's generation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260606000000_create_flashcards.sql:35`
- **Detail**: The `flashcards_insert_own` policy only checks that `flashcards.user_id` equals `auth.uid()`. It does not verify that a non-null `generation_id` belongs to the same user, so an authenticated user who knows another generation UUID could link a card row to it.
- **Fix**: Add generation ownership validation to the insert policy, and mirror it on update if `generation_id` remains mutable.
  - Strength: Preserves the current schema while closing the cross-user association hole at the RLS boundary.
  - Tradeoff: Requires a follow-up migration because the original migration may already be applied.
  - Confidence: HIGH — the policy currently has no generation ownership check.
  - Blind spot: The exact Supabase policy expression still needs local migration verification.
- **Decision**: FIXED via `supabase/migrations/20260610000000_enforce_flashcard_generation_ownership.sql`.

### F2 — Provider error details are returned to clients

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/generate.ts:47`
- **Detail**: `GenerationError` messages are returned in the JSON response. Those messages can include raw OpenRouter response bodies from `src/lib/services/generation.ts`, exposing provider internals or unexpected upstream content to authenticated users.
- **Fix**: Return a stable generic client message such as `Generation failed`, while keeping detailed diagnostics in server logs.
- **Decision**: ACCEPTED-AS-RULE: Do not expose upstream provider errors to clients. Code fix was not applied because no confirmation was provided after the lesson was saved.

### F3 — Model output is not trimmed or count-validated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/generation.ts:18`
- **Detail**: The plan says returned cards should be trimmed. The schema accepts whitespace-only `front`/`back` values, allows any number of cards greater than zero, and the function returns `slice(0, count)` without ensuring exactly the requested count. This can persist fewer cards than requested or whitespace-padded card content.
- **Fix**: Normalize model output with trimmed strings, validate non-empty trimmed values, and require exactly `count` cards after slicing or validation.
  - Strength: Matches the plan contract and keeps bad model output out of persisted draft cards.
  - Tradeoff: May turn some imperfect model responses into user-visible 502 errors instead of saving partial output.
  - Confidence: HIGH — current schema and return path directly show the gap.
  - Blind spot: Product may prefer accepting fewer cards over failing the request, but that is not what S-01 specified.
- **Decision**: ACCEPTED-AS-RULE: Normalize and validate model output before persistence. Code fix was not applied because no confirmation was provided after the lesson was saved.

### F4 — Migration verification is blocked by local Supabase

- **Severity**: 👀 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A
- **Detail**: `npm run lint` passed. `npm run build` passed when rerun outside the sandbox. `npx supabase migration up` failed because local Postgres was not listening on `127.0.0.1:54322`, so the migration success criterion is not currently verifiable in this environment.
- **Fix**: Start local Supabase/Postgres and rerun `npx supabase migration up`.
- **Decision**: ACCEPTED-AS-RULE: Verify Supabase migrations only when local Postgres is running. Environment fix was declined.
