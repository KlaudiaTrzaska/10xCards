# CI Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Research: `context/changes/testing-quality-gates-wiring/research.md`

## What & Why

Phase 4 of the test rollout closes the final gaps needed for CI to truly gate merges: strict lint enforcement, accurate branch-name documentation, and confirmed GitHub branch protection. Both `npm run lint` and `npm test` are already in the CI pipeline — this plan tightens what's there rather than adding anything new.

## Starting Point

`.github/workflows/ci.yml` already runs lint and test on every push and PR to `main`. The lint script (`eslint .`) has no `--max-warnings=0` flag, so ESLint warnings silently pass. Both `CLAUDE.md` and `AGENTS.md` describe CI as targeting `master` (stale). Branch protection status on GitHub is unverified.

## Desired End State

`npm run lint` enforces zero warnings locally and in CI. AI-rules docs accurately say `main`. GitHub requires the `CI / ci` check to pass before any PR on `main` can be merged. `test-plan.md §3` Phase 4 row is `complete`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| `--max-warnings=0` placement | `package.json` lint script | Single source of truth for local + CI; zero current warnings make this safe today | Plan |
| Branch protection | Hard requirement for Phase 4 completion | Test-plan goal is "gated before merge" — CI running without protection doesn't satisfy that | Research / Plan |
| Phase structure | 2 phases (code edits / verify + close) | Natural split between automated edits and the GitHub manual step | Plan |

## Scope

**In scope:**
- `package.json` lint script: add `--max-warnings=0`
- `CLAUDE.md:54` and `AGENTS.md:22`: fix "master" → "main"
- GitHub branch protection: verify/add rule requiring `CI / ci` before merge
- `test-plan.md §3`: mark Phase 4 `complete`

**Out of scope:**
- Any changes to `.github/workflows/ci.yml`
- `astro check` type-checking gate
- New ESLint rules or severity changes
- New tests

## Architecture / Approach

Three one-line code edits land in Phase 1. Phase 2 is a manual GitHub Settings step followed by the test-plan closure. No infrastructure changes — this is pure configuration tightening.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Code edits | Strict lint + accurate docs in one commit | A warn-severity rule added after today could surface unexpectedly — mitigated by zero current warnings |
| 2. Branch protection + closure | GitHub gate confirmed; Phase 4 marked complete | Requires GitHub Settings access; no code path to automate |

**Prerequisites:** `main` branch exists on remote (confirmed), CI YAML already in place (confirmed)
**Estimated effort:** ~15 min across 2 phases

## Open Risks & Assumptions

- Zero ESLint warnings confirmed today (`npm run lint -- --max-warnings=0` exits 0); any new warn-level rule added between now and implementation would need attention
- GitHub branch protection step requires Settings access — cannot be automated in this environment

## Success Criteria (Summary)

- `npm run lint` exits 0 with `--max-warnings=0` in the lint script
- GitHub `main` branch requires `CI / ci` check to pass before merge
- `test-plan.md §3` Phase 4 row shows `complete`
