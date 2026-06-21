# SRS Integrity and Cross-User Data Boundary — Plan Brief

> Full plan: `context/changes/testing-srs-integrity-data-boundary/plan.md`
> Research: `context/changes/testing-srs-integrity-data-boundary/research.md`

## What & Why

Phase 3 of the test rollout adds integration tests for the SRS review API and the due-cards endpoint — the only two production routes with zero automated coverage. The goal is to prove Risk #3 (review history stays consistent after grading) and Risk #4 (a user cannot grade or access another user's cards via the API).

## Starting Point

Phases 1 and 2 established Vitest, the `vi.mock("@/lib/supabase")` + `makeCtx` + direct-handler-invocation pattern, and five test files covering generation and deck CRUD. The `POST /api/study/review` and `GET /api/study/due` routes have zero tests; `src/lib/services/srs.ts` has zero tests.

## Desired End State

Twelve new integration tests exist (R1–R10 for the review route, D1–D2 for due). `npm test` is green. `test-plan.md §6.5` documents the canonical SRS review test pattern. `test-plan.md §3` Phase 3 row is marked `complete`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|------------------|--------|
| srs.ts unit tests | No | The custom scheduler is exercised end-to-end by review API integration tests — no additional signal for Risks #3/#4 | Plan |
| File placement | Nested `__tests__/study/` | Mirrors the route directory structure under `src/pages/api/study/` | Plan |
| Due endpoint coverage | Minimal (401 + happy-path) | Low IDOR risk on due endpoint; budget concentrated on review route | Plan |
| Cookbook update | Yes (§6.5) | Matches Phase 2 precedent; §6.5 is currently TBD | Plan |
| ts-fsrs challenge | Custom scheduler confirmed | Scheduling uses a fixed lookup table, not ts-fsrs algorithm; test expected values from `OUTCOME_INTERVAL_DAYS` | Research |
| Non-atomic behavior | Document, not fix | INSERT-before-UPDATE is a deliberate MVP decision; R10 carries a comment rather than asserting atomicity | Research |

## Scope

**In scope:**
- `src/pages/api/__tests__/study/review.test.ts` — 10 tests (auth, validation, IDOR, first-review, re-review, lapses, COALESCE, error paths)
- `src/pages/api/__tests__/study/due.test.ts` — 2 tests (401, happy-path)
- `test-plan.md §6.5` fill-in and §3 Phase 3 status update

**Out of scope:**
- `srs.ts` unit tests
- Full due-endpoint coverage (error paths, pagination)
- `StudySession.tsx` double-submit fix (UI layer, separate change)
- Postgres RPC / review atomicity fix
- New migrations

## Architecture / Approach

No new infrastructure. Phase 3 extends the established pattern:

1. `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` at module scope (hoisted by Vitest)
2. `makeReviewSupabase({ card?, insertError?, updateError? })` factory — routes three sequential Supabase calls (SELECT card → INSERT review_log → UPDATE flashcard) via `fromCallCount` tracking
3. `makeCtx(body, user?)` — builds native `Request` + `locals.user`, cast to `Parameters<APIRoute>[0]`
4. Invoke exported `POST` handler directly; inspect `res.status` + `await res.json()`
5. RFC 4122-compliant UUIDs throughout (Zod v4 requirement)

The IDOR proof (R4) uses explicit `USER_A_ID` / `USER_B_ID` constants: User B submits a review for User A's card; the mock SELECT returns null → 404, and a spy confirms zero calls to `from("review_logs")`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Review API tests | `review.test.ts` with R1–R10 | Three-call mock routing must match actual handler call order |
| 2. Due API tests | `due.test.ts` with D1–D2 | Three parallel `Promise.all` calls need separate mock routing |
| 3. Cookbook + status | §6.5 filled, §3 Phase 3 `complete` | Cookbook must be self-contained enough for future contributors |

**Prerequisites:** Phase 2 complete (already done — all 15 Progress items checked). `npm test` green on current branch.
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- The `makeReviewSupabase` call-count routing assumes Vitest resolves the three `from()` calls in creation order (SELECT, INSERT, UPDATE). This is deterministic in the synchronous mock but should be verified during Phase 1 implementation.
- R8 (first_reviewed_at COALESCE) — the plan allows either asserting the UPDATE args or just checking `status 200`. If the simpler form is chosen, COALESCE correctness is only proven by code review, not by the test.

## Success Criteria (Summary)

- `npm test` green — 12 new tests, all passing
- R4 explicitly names USER_A / USER_B and identifies itself as the IDOR proof
- §6.5 is readable standalone — a future contributor can write a new review test from it without reading the full plan
