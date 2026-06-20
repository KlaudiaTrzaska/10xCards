# Bootstrap + Generation Resilience — Plan Brief

> Full plan: `context/changes/testing-bootstrap-generation-resilience/plan.md`
> Research: `context/changes/testing-bootstrap-generation-resilience/research.md`

## What & Why

Bootstrap the first test suite for 10xCards and prove the LLM generation pipeline is resilient to malformed provider responses. Three active code gaps are confirmed by research — a provider error body leaking to the client, whitespace-only card fields persisting silently, and the model returning fewer cards than requested without an error. Phase 1 of the test-plan rollout fixes all three and proves the fixes with 17 tests.

## Starting Point

No test infrastructure exists: no `vitest.config.*`, no test files, no `test` script, no CI test step. `src/lib/services/generation.ts` and `src/pages/api/generate.ts` are untested production code. Two of the three gaps are already flagged in `context/foundation/lessons.md` with `TODO` fix rules.

## Desired End State

`npm test` runs 17 tests (11 unit + 6 integration) that all pass. The 502 response body contains a safe fixed string, never a raw OpenRouter payload. Whitespace-only cards are rejected at the service layer. Fewer-than-requested cards throw a `GenerationError`. A `test` step runs in CI before build.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Test environment | Node only, no DOM | Only service + API route code is in scope; React testing deferred to Phase 2 | Plan |
| Fix + test sequencing | Fix first, then prove with test | Tests that document unfixed bugs are not "proving protection" per §1 of the test plan | Plan |
| Count enforcement fix | Dynamic `ResponseSchema` inside `generateCards()` with `.min(count)` | Schema is the contract; one-line change, no separate assertion layer needed | Plan |
| 502 error message | Fixed generic string `"Generation failed — please try again."` | Simplest fix, zero information leakage, easiest to assert in I1 test | Plan |
| Whitespace fix location | `CardSchema` — `.trim().min(1)` | Schema is the single source of truth; normalisation and validation in one place | Plan |
| Integration test style | Invoke `POST` handler directly, no HTTP server | `POST` is an async function — direct call + `Response` inspection is cheaper and stable | Research |
| Frontend null-guard | Deferred to Phase 2 | Only reachable via a buggy 200 response; not a Risk #1 or #7 scenario | Plan |

## Scope

**In scope:**
- Install and configure Vitest (node environment)
- `astro:env/server` virtual module aliased to a static mock for test isolation
- Fix `CardSchema` (`.trim().min(1)`) and `ResponseSchema` (`.min(count)`, moved inside function)
- Fix `generate.ts:47` (sanitize 502 body)
- 11 unit tests for `generateCards()` (mock `fetch` at HTTP edge)
- 6 integration tests for `POST /api/generate` (mock `generateCards` + `createClient`)
- Add `test` script to `package.json` and `test` step to CI YAML
- Update `§6` cookbook in `test-plan.md`

**Out of scope:**
- `GenerateForm.tsx` null-guard bug (`!== null` vs `undefined`) — Phase 2
- React/DOM/component tests
- e2e browser tests
- SRS, deck CRUD, or auth testing — later phases
- Real OpenRouter API calls in tests

## Architecture / Approach

Unit tests mock `globalThis.fetch` via `vi.stubGlobal`, control the mock `Response` per-test, and call `generateCards()` directly. Integration tests use two module-level `vi.mock()` calls to replace `generateCards` and `createClient`, then invoke the exported `POST` handler with a `makeCtx()` helper that constructs a minimal `APIContext`. Both layers inspect the returned `Response` by status code and JSON body — no HTTP server, no browser. The Astro virtual module `astro:env/server` is neutralised via a `resolve.alias` in `vitest.config.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Bootstrap Vitest | `npm test` runs; `astro:env/server` mock wired | Vitest/Vite 7 peer dep conflict |
| 2. Service fixes + unit tests | 11 passing unit tests; whitespace + count gaps fixed | `ResponseSchema` move breaks something subtle in Zod transform chain |
| 3. Route fix + integration tests | 6 passing integration tests; 502 leak fixed | Supabase mock chain for I6 happy path is tricky to sequence |
| 4. CI wiring + cookbook | CI runs tests before build; §6 is actionable | CI step ordering (must be after `astro sync`, before `build`) |

**Prerequisites:** Node 22, Vite 7 already in use (via override). No DB access required for tests.
**Estimated effort:** ~2–3 focused sessions across 4 phases.

## Open Risks & Assumptions

- Vitest version compatibility with `vite@^7.3.2` override needs a quick check (`npm install -D vitest` — inspect peer warnings before proceeding).
- The `astro:env/server` alias approach is the standard workaround for testing Astro API routes outside the Astro runtime; if Vitest's module resolution order is unexpected, a `vi.mock("astro:env/server", ...)` in the test file may be needed as a fallback.
- The I6 Supabase mock must return different shapes for two chained calls in the same test — ordering matters. If `.mockReturnValueOnce` per chain proves fragile, use a call-counter factory.

## Success Criteria (Summary)

- `npm test` exits 0 with 17 passing tests and no linting errors
- Generating a deck in the browser works end-to-end after all fixes land
- CI workflow is green on push (lint → test → build all pass)
