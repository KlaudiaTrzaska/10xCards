# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-20 (Phase 1 complete)

---

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   \<area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`.

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | LLM provider returns invalid/malformed output and the generation flow crashes or shows garbage instead of draft cards | High | High | interview Q1; PRD FR-004; hot-spot dir `src/components/generation/` (6 commits/30d); hot-spot dir `src/pages/api/` (4 commits/30d) |
| 2 | Changes to generation or deck management silently break curation, save, or list flows | High | High | interview Q3; PRD FR-005, FR-006, FR-007; hot-spot dir `src/pages/` (15 commits/30d) |
| 3 | Spaced-repetition scheduling corrupts or loses review history across sessions | High | Medium | PRD NFR guardrail; roadmap S-04 risk note |
| 4 | User accesses or mutates another user's flashcards or deck data (IDOR / RLS gap) | High | Medium | PRD §Access Control (per-user data boundary); auth + API surface in baseline |
| 5 | Partial deck save — some accepted cards persist while others fail, leaving an inconsistent deck | High | Medium | roadmap S-02 risk note; PRD FR-005 (atomic curation) |
| 6 | Unauthenticated user reaches product routes (generate, deck, study) and reads or writes data | High | Low–Medium | roadmap F-01 risk note; hot-spot dir `src/middleware.ts` (3 commits/30d) |
| 7 | Oversized or malicious pasted input causes generation to fail opaquely or exhaust resources | Medium | Medium | PRD FR-003 (paste-only input); abuse lens — untrusted input |

**Impact × Likelihood rubric:**

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low | cosmetic, easily reverted, no data effect | stable code, rarely touched |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Invalid LLM JSON/shape → user sees clear error, no crash, no partial corrupt drafts stored | "OpenRouter always returns valid JSON" | OpenRouter call site, response parsing/validation, error translation to UI | unit + integration (mock HTTP edge only) | Asserting against production parser output; happy-path-only with real API |
| #2 | Accept/edit/discard + list/edit/delete still work after generation changes | "Types compile so flow works" | Curation → save-deck → deck CRUD call chain, zod schemas | integration | Testing React components in isolation with mocked everything |
| #3 | Review grades update FSRS state without losing prior `review_logs` entries | "ts-fsrs handles it" | Review API, FSRS column updates, append-only log semantics | integration (+ DB fixture) | Re-implementing FSRS logic in test assertions |
| #4 | User B cannot read/update/delete User A's cards via any deck/generation/study API | "RLS exists so we're fine" | RLS policies, auth cookie shape, API ownership checks | integration (two-user fixtures) | Testing only middleware redirect, not API-level IDOR |
| #5 | Network/DB error mid-save → all-or-nothing (no partial deck) | "Client sends batch so it's atomic" | save-deck transaction semantics | integration | Mocking DB to always succeed |
| #6 | Logged-out request to product routes gets 401/redirect, never data | "Middleware covers it" | PUBLIC_ROUTES allow-list, protected API behavior | integration | E2e browser login for every auth check |
| #7 | Absurdly long paste → validation error with message, no hang/OOM | "Users won't paste that much" | Input limits in generate API + zod schema | unit on validation boundary | Snapshot of error HTML |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Bootstrap + generation resilience | Set up Vitest and prove LLM malformed-response handling and paste validation | #1, #7 | unit + integration | complete | context/changes/testing-bootstrap-generation-resilience/ |
| 2 | Generation & deck flow integration | Protect curation → atomic save → deck CRUD paths that change most often | #2, #5 | integration | change opened | context/changes/testing-generation-deck-flow/ |
| 3 | SRS integrity + data boundary | Review history consistency and cross-user access denied | #3, #4 | integration | not started | — |
| 4 | Quality-gates wiring | Lock lint + tests in CI; no new test types | cross-cutting | CI gate | not started | — |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|-------|---------|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

---

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | none yet — see Phase 1 | No runner config or test files exist; Phase 1 bootstraps |
| API mocking | MSW or Vitest mock | none yet — see Phase 1 | HTTP-edge mocking choice to be confirmed by research |
| e2e | none yet | — | Deferred; integration catches most flow breaks at lower cost |
| accessibility | none yet | — | Out of scope for MVP rollout |

**Stack grounding tools (current session):**
- Docs: none — Context7/framework docs MCP not available in current session; checked: 2026-06-20
- Search: WebSearch — available for tool version lookups if needed; checked: 2026-06-20
- Runtime/browser: cursor-ide-browser MCP — available but deferred (cost × signal; see Q5 negative space); checked: 2026-06-20
- Provider/platform: Linear MCP — issue tracking only, no quality-gate relevance; checked: 2026-06-20

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (already wired) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions in generation and validation |
| integration (flow + data) | local + CI | required after §3 Phase 2 | curation, save-deck, deck CRUD regressions |
| integration (SRS + RLS) | local + CI | required after §3 Phase 3 | review history corruption, IDOR |
| test step in CI YAML | CI | required after §3 Phase 4 | all of the above gated before merge |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Place new unit test files under `src/lib/services/__tests__/` (or a sibling `__tests__/` folder next to the module under test).

Key conventions:

- Import test utilities with explicit named imports — `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`. No `globals: true` in `vitest.config.ts`.
- Mock `fetch` at the global edge with `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`; restore with `vi.unstubAllGlobals()` in `afterEach`.
- Construct mock `Response` objects inline:
  ```typescript
  new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })
  ```
- Assert on `GenerationError` using `instanceof` and string-contains checks on `.message`, not exact wording — the message text may change, but the shape must not.
- Canonical examples: `src/lib/services/__tests__/generation.test.ts` (tests U1–U11).

### 6.2 Adding an integration test

Place new API-route integration test files under `src/pages/api/__tests__/`.

Key conventions:

- Two `vi.mock()` calls at module scope (hoisted by Vitest before imports execute):
  - `vi.mock("@/lib/services/generation", () => ({ ... }))` — replace `generateCards` with `vi.fn()`; inline any error classes the factory needs (avoids hoisting conflicts with `importOriginal`).
  - `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))`.
- Build a minimal `makeCtx(body, user?)` helper that constructs a native `Request` with `method: "POST"`, `Content-Type: application/json`, and `body: JSON.stringify(body)`. Cast the result to `Parameters<APIRoute>[0]` via `as unknown as Parameters<APIRoute>[0]`.
- Invoke the exported route handler directly — `const res = await POST(makeCtx(...))` — and inspect the returned `Response`: `res.status`, `await res.json()`.
- Type the parsed body with a local interface (`interface ApiBody { error?: string; ... }`) to satisfy `@typescript-eslint/no-unsafe-member-access`.
- Canonical examples: `src/pages/api/__tests__/generate.test.ts` (tests I1–I6).

### 6.3 Adding a test for the LLM generation path

**Rule: never call real OpenRouter in tests.**

- **Unit tests of `generateCards()`** — mock `fetch` with `vi.stubGlobal("fetch", vi.fn())`. Shape the mock `Response` to simulate every branch: HTTP error, malformed JSON, schema mismatch, whitespace-only fields, fewer cards than requested, happy path. See U1–U11 in `src/lib/services/__tests__/generation.test.ts`.
- **API route integration tests** — mock `generateCards` itself with `vi.mock("@/lib/services/generation", ...)` and drive the route handler directly. This isolates the route's error-translation and validation logic from the service. See I1–I6 in `src/pages/api/__tests__/generate.test.ts`.
- **Never** mock at the Supabase or database layer to simulate LLM failures — the mock must sit at the HTTP boundary (`fetch`) or the service boundary (`generateCards`), depending on which layer is under test.

### 6.4 Adding a test for the curation → save-deck flow

TBD — see §3 Phase 2 (Generation & deck flow integration).

### 6.5 Adding a test for the SRS review path

TBD — see §3 Phase 3 (SRS integrity + data boundary). Pattern: two-user DB fixture; assert append-only `review_logs` and FSRS column updates without re-implementing algorithm logic.

### 6.6 Per-rollout-phase notes

(Filled in as phases ship.)

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI look and feel** — visual appearance, layout, and styling. Re-evaluate if user research surfaces repeated confusion. (Source: interview Q5.)
- **Configuration plumbing** — wrangler config, Supabase config, env var wiring, CI YAML scaffolding in isolation. These are verified by the build step; do not add dedicated config tests. (Source: interview Q5.)
- **Infrastructure overinvestment** — e2e browser flows, visual regression suites, multimodal review hooks. Integration tests catch most regressions at far lower maintenance cost. (Source: interview Q5; cost × signal principle.)
- **Generated/third-party code** — ts-fsrs algorithm internals, shadcn/ui components, Supabase SDK internals. Test the contract at the boundary, not the library. (Source: cost × signal principle.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-20
- Stack versions last verified: 2026-06-20
- AI-native tool references last verified: 2026-06-20 (none in use)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
