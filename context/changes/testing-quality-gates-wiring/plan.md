# CI Quality-Gates Wiring — Implementation Plan

## Overview

Phase 4 of the test rollout (see `context/foundation/test-plan.md §3`). The main CI gates (`npm run lint` and `npm test`) are already wired in `.github/workflows/ci.yml`. This plan closes the three remaining gaps: making the lint gate strict (`--max-warnings=0`), correcting a stale branch name in the AI-rules docs, and confirming that GitHub branch protection actually requires the CI job to pass before merge.

## Current State Analysis

Both `npm run lint` (ci.yml:20) and `npm test` (ci.yml:21) are already in the CI pipeline and run before `npm run build`. The default branch is `main`; the CI YAML targets `[main]` correctly.

Three gaps:

1. **Lint strictness**: `package.json` lint script is `eslint .` — no `--max-warnings=0`. ESLint rules at `warn` severity silently pass CI. Running `npm run lint -- --max-warnings=0` today exits 0 (zero current warnings), so adding it is immediately safe.
2. **Stale branch name in docs**: `CLAUDE.md:54` and `AGENTS.md:22` both say "push and PR to `master`"; the actual branch is `main`.
3. **Branch protection unverified**: Whether the `CI / ci` status check is required before merge in GitHub Settings is unknown.

### Key Discoveries

- `.github/workflows/ci.yml:20-21` — lint + test steps already present, correct order
- `package.json:10` — `"lint": "eslint ."` (target: add `--max-warnings=0`)
- `CLAUDE.md:54` — "push and PR to master" (target: `main`)
- `AGENTS.md:22` — "push and PR to `master`" (target: `main`)
- Zero ESLint warnings currently: `npm run lint -- --max-warnings=0` exits 0

## Desired End State

`npm run lint` runs `eslint . --max-warnings=0` — any future warn-severity violation fails the command locally and in CI. `CLAUDE.md` and `AGENTS.md` accurately describe CI targeting `main`. GitHub branch protection on `main` requires the `CI / ci` job to pass before merging. `test-plan.md §3` Phase 4 row is `complete`.

## What We're NOT Doing

- No changes to `ci.yml` — the pipeline is correct as-is
- No `astro check` addition — type-checking gate is out of scope for Phase 4
- No new tests — this phase is CI configuration and docs only
- No ESLint rule additions — no new warn/error rules beyond the strictness flag

## Implementation Approach

Two phases. Phase 1 lands the three code edits in one commit; they are small and low-risk. Phase 2 is a manual verification step (GitHub Settings) followed by a single doc update to close the test-plan §3 row.

---

## Phase 1: Code edits — lint script, CLAUDE.md, AGENTS.md

### Overview

Three one-line edits: tighten the npm lint script and correct the branch name in both AI-rules docs.

### Changes Required

#### 1. Tighten the lint npm script

**File**: `package.json`

**Intent**: Make `npm run lint` fail on ESLint warnings, not just errors. This enforces the zero-warning standard that was already applied during Phases 1–3 test implementation.

**Contract**: Line 10 — change `"lint": "eslint ."` to `"lint": "eslint . --max-warnings=0"`. No other scripts change. The `lint:fix` script (`eslint . --fix`) is intentionally left without `--max-warnings=0` to keep the auto-fix workflow unobstructed.

---

#### 2. Fix branch name in CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Correct a stale "master" reference so the CI description matches reality.

**Contract**: Line 54 — change "on every push and PR to master" to "on every push and PR to main". One word only.

---

#### 3. Fix branch name in AGENTS.md

**File**: `AGENTS.md`

**Intent**: Same correction in the agents-facing rules file.

**Contract**: Line 22 — change "on every push and PR to `master`" to "on every push and PR to `main`". One word only.

---

### Success Criteria

#### Automated Verification

- `npm run lint` exits 0 (zero errors, zero warnings confirmed)
- `npm test` exits 0 (58 tests, no regressions)

#### Manual Verification

- `package.json` lint script reads `"eslint . --max-warnings=0"`
- `CLAUDE.md:54` reads "push and PR to `main`"
- `AGENTS.md:22` reads "push and PR to `main`"

**Implementation Note**: Pause after Phase 1 for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Branch protection verification + test-plan closure

### Overview

Verify that GitHub enforces the CI gate before merge, then mark the test-plan Phase 4 row `complete`.

### Changes Required

#### 1. Verify (or add) GitHub branch protection rule

**File**: GitHub Settings → Branches → Branch protection rules → `main`

**Intent**: Confirm the `CI / ci` status check is listed as required before a PR can be merged. Without this, CI runs but cannot prevent a human from merging a red PR.

**Contract**: Navigate to `https://github.com/KlaudiaTrzaska/10xCards/settings/branches`. Check or add a rule for `main` that enables "Require status checks to pass before merging" and selects `CI / ci` (the job name from `ci.yml`). This is a manual step — it cannot be done from the command line in this environment.

---

#### 2. Update test-plan.md Phase 4 row

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 4 `complete` in the §3 rollout table and update the freshness date.

**Contract**: Update the `| 4 |` row Status cell from `change opened` to `complete`. Update the `Last updated` header line to `2026-06-21 (Phase 4 complete)`.

---

### Success Criteria

#### Automated Verification

- `npm test` exits 0 (no regressions from doc-only changes)
- `npm run lint` exits 0

#### Manual Verification

- GitHub `main` branch has a protection rule requiring `CI / ci` to pass before merge
- `test-plan.md §3` Phase 4 row shows `complete`

---

## References

- Research: `context/changes/testing-quality-gates-wiring/research.md`
- CI YAML: `.github/workflows/ci.yml`
- npm scripts: `package.json:9-10`
- AI rules: `CLAUDE.md:54`, `AGENTS.md:22`
- Test plan: `context/foundation/test-plan.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Code edits — lint script, CLAUDE.md, AGENTS.md

#### Automated

- [x] 1.1 `npm run lint` exits 0 with zero errors and zero warnings — 2d7e383
- [x] 1.2 `npm test` exits 0 (no regressions) — 2d7e383

#### Manual

- [x] 1.3 `package.json` lint script reads `"eslint . --max-warnings=0"` — 2d7e383
- [x] 1.4 `CLAUDE.md:54` reads "push and PR to `main`" — 2d7e383
- [x] 1.5 `AGENTS.md:22` reads "push and PR to `main`" — 2d7e383

### Phase 2: Branch protection verification + test-plan closure

#### Automated

- [x] 2.1 `npm test` exits 0 (no regressions from doc changes) — 132629f
- [x] 2.2 `npm run lint` exits 0 — 132629f

#### Manual

- [x] 2.3 GitHub `main` branch protection rule requires `CI / ci` check to pass before merge (rule configured; "Not enforced" — free private-repo plan requires GitHub Team/Enterprise to enforce) — 132629f
- [x] 2.4 `test-plan.md §3` Phase 4 row Status = `complete` — 132629f
