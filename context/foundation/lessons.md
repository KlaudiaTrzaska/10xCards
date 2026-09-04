# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Do not expose upstream provider errors to clients

- **Context**: `src/pages/api/generate.ts:47`
- **Problem**: `GenerationError` messages are returned in the JSON response. Those messages can include raw OpenRouter response bodies from `src/lib/services/generation.ts`, exposing provider internals or unexpected upstream content to authenticated users.
- **Rule**: TODO: Fill in the recurring rule to apply for external provider errors.
- **Applies to**: TODO: Fill in the routes/services this rule applies to.

## Normalize and validate model output before persistence

- **Context**: `src/lib/services/generation.ts:18`
- **Problem**: The model response schema accepts whitespace-only card fields and any card count greater than zero, then returns `slice(0, count)` without trimming or verifying exactly the requested count. This can persist malformed or partial AI output.
- **Rule**: TODO: Fill in the recurring rule for AI/model output normalization and validation.
- **Applies to**: TODO: Fill in the services/routes where generated model output is accepted or persisted.

## Verify Supabase migrations only when local Postgres is running

- **Context**: `npx supabase migration up`
- **Problem**: Migration verification failed because local Postgres was not listening on `127.0.0.1:54322`, leaving the migration success criterion unverified despite lint/build passing.
- **Rule**: TODO: Fill in the recurring rule for migration verification prerequisites.
- **Applies to**: TODO: Fill in the workflows where Supabase migration commands are run.

## Never assume local Supabase — use CLI against remote for migration verification

- **Context**: Any plan or implementation phase that includes Supabase migration verification steps (`npx supabase migration up` or similar)
- **Problem**: This project has no local Supabase/Postgres instance. Steps that require a local DB connection fail silently or with a connection error, leaving migration verification unconfirmed even when lint/build pass.
- **Rule**: Never list `npx supabase migration up` (local) as a verification step. Migration verification for this project must use the Supabase CLI against the remote/hosted instance (e.g. `supabase db push` or dashboard inspection). Plans must not assume local Postgres is running.
- **Applies to**: plan, plan-review, implement, impl-review

## Guard async handlers against double submission

- **Context**: `src/components/study/StudySession.tsx:105-109`
- **Problem**: `handleGrade` sets `isSubmitting` via React state but has no synchronous guard. A fast double-click before re-render can fire two review POSTs for the same card, duplicating `review_logs`.
- **Rule**: TODO: Add an early `isSubmitting` return or a synchronous `useRef` lock at the start of any handler that POSTs irreversible mutations.
- **Applies to**: TODO: Interactive React handlers that POST reviews, saves, or deletes.

## Trim and validate inline edit fields before staging curation saves

- **Context**: `src/components/generation/CurationPanel.tsx:243-248`
- **Problem**: Curation edit Confirm saves textarea values without trim or empty checks. Whitespace-only front/back can reach `save-deck`, which only enforces `min(1)` on raw strings.
- **Rule**: TODO: Mirror modal validation — trim on confirm and block empty fields before staging an edited card decision.
- **Applies to**: TODO: Inline edit flows that feed validated API payloads (curation, deck CRUD).
