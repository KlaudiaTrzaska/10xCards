# Generation & Deck Flow Integration Tests — Plan Brief

> Full plan: `context/changes/testing-generation-deck-flow/plan.md`
> Research: `context/changes/testing-generation-deck-flow/research.md`

## What & Why

Phase 2 of the test rollout adds integration tests for the curation → save-deck → deck CRUD call chain — the paths that change most often and have zero coverage. Without tests here, any refactor of generation, save, or deck management silently breaks curation, save, or list flows (Risk #2) and there's no safety net around the non-atomic multi-step save (Risk #5).

## Starting Point

Phase 1 bootstrapped Vitest, `vitest.config.ts`, the `makeCtx()` helper, and the `vi.mock("@/lib/supabase")` pattern. Three route files — `save-deck.ts`, `deck/index.ts`, `deck/[id].ts` — have no tests. One known server-side gap: `save-deck.ts` `RequestSchema` accepts whitespace-only strings in `edited[].front/back` because zod `min(1)` counts whitespace characters.

## Desired End State

29 new integration tests spread across three new test files, all passing under `npm test`. `§6.4` of the test plan cookbook is filled in. The whitespace-only edit gap is closed at the server boundary. The test plan Phase 2 row reads `complete`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|------------------|--------|
| Partial-save test strategy (Risk #5) | Test boundary that exists — mock each step to fail, assert 500, comment about missing DB transaction | No Postgres RPC exists; idempotent retry is the MVP mitigation, not atomicity | Research / Plan |
| Whitespace-only edit gap | Server-side fix only — `.trim()` in zod schema | Closes the server boundary gap with a one-line change; UI fix is independent and deferred | Research / Plan |
| savedCount over-reporting | Skip | Not a crash risk; deferred to a dedicated fix change | Plan |
| Test file organization | One file per route (3 files) | Mirrors `generate.test.ts` convention; each file has its own mock factory | Plan |
| CRUD coverage depth | Full branch coverage — auth, happy path, DB error, lock semantics | Risk #2 targets "silently break" scenarios; 500 paths must be covered | Test plan / Plan |
| React/DOM tests | Out of scope | Phase 2 targets API routes only — cost × signal, same as Phase 1 | Test plan |

## Scope

**In scope:**
- `POST /api/save-deck` tests (S1–S9) + zod trim fix
- `GET /api/deck` and `POST /api/deck` tests (D1–D8)
- `PATCH /api/deck/[id]` and `DELETE /api/deck/[id]` tests (E1–E12)
- `§6.4` cookbook entry in `test-plan.md`

**Out of scope:**
- CurationPanel React component tests
- savedCount accuracy fix
- Postgres RPC atomic save
- GenerateForm null-guard fix (Phase 1 deferred)
- e2e / browser tests

## Architecture / Approach

All three test files follow the Phase 1 pattern: `vi.mock("@/lib/supabase")` at module scope, a `makeCtx()` helper that builds a minimal `Request` + `locals.user`, and a `make<Route>Supabase()` factory that controls per-step error injection. The main wrinkle is two new `makeCtx` variants:
- **GET /api/deck** requires `url: new URL("http://localhost/api/deck?page=N")` alongside `request` because the route reads `context.url.searchParams`.
- **PATCH/DELETE /api/deck/[id]** requires `params: { id }` because the route reads `context.params.id`.

The `[id].ts` Supabase mock tracks two calls (`from()` × 2): first for `fetchCardForMutation`'s `maybeSingle()` select, second for the actual update or delete. The `save-deck.ts` mock tracks three calls (discard, accept, edit) to inject failures independently at each step.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. save-deck fix + tests | Whitespace trim fix live; S1–S9 green | Three-step mock is complex; call-index tracking must be correct |
| 2. Deck list + create tests | D1–D8 green | `context.url` property required — easy to miss in makeGetCtx |
| 3. Deck edit + delete tests | E1–E12 green | Two-call mock for `fetchCardForMutation` + actual mutation |
| 4. Cookbook update | `§6.4` filled in; Phase 2 row = `complete` | None — prose only |

**Prerequisites:** Phase 1 test bootstrap complete (Vitest configured, `generate.test.ts` passing). ✓ Already done.
**Estimated effort:** ~1-2 focused sessions across 4 phases.

## Open Risks & Assumptions

- The three-call save-deck mock may need adjustment if the Supabase client builder doesn't chain predictably under `vi.fn()` — if so, switch to `vi.fn().mockResolvedValueOnce()` sequences rather than a factory.
- `deck-id.test.ts` assumes `PATCH` and `DELETE` can share the same mock factory since they both go through `fetchCardForMutation` first — confirmed by reading the source.

## Success Criteria (Summary)

- `npm test` passes with 29 new tests plus all Phase 1 tests (17 existing) — no regressions
- `save-deck.ts` rejects whitespace-only `edited` fields with a 400 response
- `§6.4` in `test-plan.md` has concrete examples pointing to `save-deck.test.ts` S1–S9
