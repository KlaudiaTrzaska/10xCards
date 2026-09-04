---
date: 2026-06-21T18:54:00+02:00
researcher: AI Agent
git_commit: e5206dbcf16c7feed80e38df03e2ad7311c653b7
branch: cursor/add-test-plan
repository: 10xCards
topic: "CI quality-gates wiring for testing-quality-gates-wiring (Phase 4)"
tags: [research, codebase, ci, github-actions, quality-gates, lint, vitest]
status: complete
last_updated: 2026-06-21
last_updated_by: AI Agent
---

# Research: CI Quality-Gates Wiring (Phase 4)

**Date**: 2026-06-21T18:54:00+02:00
**Researcher**: AI Agent
**Git Commit**: e5206dbcf16c7feed80e38df03e2ad7311c653b7
**Branch**: cursor/add-test-plan
**Repository**: KlaudiaTrzaska/10xCards

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md`. Verify the current state of CI quality gates, identify what is already wired, and determine what remains to truly "lock" lint + tests before merge.

## Summary

**The main gates are already wired.** `.github/workflows/ci.yml` already runs `npm run lint` (line 20) and `npm test` (line 21) in sequence before `npm run build`. Both commands are confirmed working: 58 tests pass and lint is clean on the current branch. The default branch is `main` — the CI YAML correctly targets `main`.

Two gaps remain before Phase 4 is truly complete:

1. **Lint strictness**: `npm run lint` runs `eslint .` without `--max-warnings=0`. Lint warnings (as opposed to errors) would silently pass CI. The `package.json` lint script does not include `--max-warnings=0`. Adding it to the npm script or overriding it in the CI step would make the gate strict.

2. **AGENTS.md / CLAUDE.md branch name**: Both docs say "push and PR to **master**" — but the remote HEAD branch is `main` and the CI YAML correctly targets `main`. The docs are stale. Correcting them is a one-line fix per file.

A third item — **GitHub branch protection rules** (requiring the `ci` check to pass before a PR can merge) — cannot be verified from the command line without GitHub API access. This is a GitHub-side configuration step that the plan should call out as a manual verification.

## Detailed Findings

### 1. Current CI YAML — `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx astro sync
      - run: npm run lint      # ← already wired
      - run: npm test          # ← already wired
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

**Key facts:**
- Both `npm run lint` (line 20) and `npm test` (line 21) are present.
- They run before `npm run build`, so a test failure blocks the build.
- The workflow triggers on `push` and `pull_request` to `main` — correct.
- Node version: 22 — matches `.nvmrc` (`22.14.0`).
- `npx astro sync` runs before lint/test (required for Astro type generation).

### 2. npm scripts — `package.json`

```json
"scripts": {
  "test":     "vitest run",
  "lint":     "eslint .",
  "lint:fix": "eslint . --fix"
}
```

- `npm test` → `vitest run` (non-interactive, exits with code 0/1). 58 tests currently pass.
- `npm run lint` → `eslint .` (no `--max-warnings=0`). Runs against all `*.ts`, `*.tsx`, `*.astro` files.

**Gap — lint strictness**: Without `--max-warnings=0`, ESLint rules configured at `warn` severity pass CI silently. During Phases 1–3 implementation, lint was called with `--max-warnings=0` against individual test files. The CI step uses the bare `npm run lint` script, which does not enforce this.

### 3. Default branch — `main`

```
git remote show origin → HEAD branch: main
```

The remote HEAD branch is `main`. The CI YAML targeting `[main]` is correct.

**Doc gap**: `CLAUDE.md` and `AGENTS.md` both describe CI as running "on every push and PR to **master**". This is stale. The correct branch name is `main`. Both files need a one-word fix.

### 4. Test suite state

- Runner: Vitest `4.1.9`, `environment: "node"`, no globals.
- Test files: 7, Tests: 58, all passing as of commit `e5206db`.
- `npm test` exits 0 on pass, 1 on failure — GitHub Actions correctly treats exit code 1 as a failed step.

### 5. Branch protection (not verifiable locally)

GitHub branch protection rules (Settings → Branches → Protection rules) can require the `ci` status check to pass before a PR is mergeable. This cannot be verified or set via the command line without `gh` API access in this environment. The plan must include a manual step: *"Verify (or add) a branch protection rule on `main` requiring the `CI / ci` check to pass before merge."*

## Code References

- `.github/workflows/ci.yml:20` — `npm run lint` step
- `.github/workflows/ci.yml:21` — `npm test` step
- `.github/workflows/ci.yml:3-7` — trigger branches (`[main]`)
- `package.json:10` — `"lint": "eslint ."` (no `--max-warnings=0`)
- `package.json:9` — `"test": "vitest run"`
- `CLAUDE.md` — "runs lint + build on every push and PR to **master**" (stale)
- `AGENTS.md` — "runs `lint` then `build` on every push and PR to `master`" (stale)

## Architecture Insights

The CI job is a single sequential job (`ci`) with no parallelism. Steps must all pass for the job to succeed. Since `npm test` appears before `npm run build`, test failures prevent the build from running — which is the correct order for fail-fast behaviour.

The `SUPABASE_URL` and `SUPABASE_KEY` secrets are only needed for the build step (Astro SSR import). Lint and test run without them.

## Historical Context

- `context/archive/2026-06-20-testing-bootstrap-generation-resilience/` — Phase 1 bootstrapped Vitest and wired the first tests; no CI changes were made at that point.
- Phases 2 and 3 added 58 tests total; CI already had `npm test` before Phase 1 shipped, so the tests have been running in CI all along (on any branch targeting `main`).

## Open Questions

1. **Branch protection rule**: Is the `CI / ci` check currently required before merging PRs on `main`? This must be verified in GitHub Settings. If not set, CI runs but doesn't actually gate merges.
2. **Lint warning level**: Are any ESLint rules currently configured at `warn` (not `error`) severity? If yes, adding `--max-warnings=0` to the lint script could break CI until those rules are promoted to `error` or suppressed. A quick `npm run lint` run (which exits 0 currently) does not reveal warnings unless `--max-warnings=0` is used.
3. **`astro check` as a CI gate**: `npx astro sync` runs (type generation), but `astro check` (type-checking) is not in the CI YAML. Whether to add it is out of scope for Phase 4 but worth noting.
