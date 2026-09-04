<!-- PLAN-REVIEW-REPORT -->
# Plan Review: AI Card Generation (S-01)

- **Plan**: `context/changes/s-01/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: SOUND (after fixes)
- **Findings**: 1 critical | 3 warnings | 2 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL → PASS after fixes |

## Grounding

7/7 existing paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Zod is not installed; plan uses it in Phase 3 and Phase 4

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 (generation service), Phase 4 (API route)
- **Detail**: `package.json` has no `zod` entry. No validation library is installed. Both the generation service and API route import and use `z.*` but the plan never says to run `npm install zod`.
- **Fix**: Added `npm install zod` as step 0 in Phase 2 Changes Required.
- **Decision**: FIXED (step 0, Phase 2)

### F2 — `supabase/migrations/` directory does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Database Migration
- **Detail**: `ls supabase/` shows only `config.toml`. No `migrations/` subdirectory.
- **Fix**: Added `mkdir -p supabase/migrations` as step 0b in Phase 2 Changes Required.
- **Decision**: FIXED (step 0b, Phase 2)

### F3 — `OPENROUTER_API_KEY` is `string | undefined` but service expects `string`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 — API Route, happy path
- **Detail**: `optional: true` types as `string | undefined`. Calling `generateCards(..., OPENROUTER_API_KEY)` where service expects `string` is a TypeScript error; at runtime `undefined` would propagate as the literal string "undefined" in the Authorization header.
- **Fix A ⭐**: Added early 503 guard at top of Phase 4 route contract before Zod validation.
- **Decision**: FIXED via Fix A

### F4 — Phase 4 INSERT contract omits `.select()` — Supabase returns `null` without it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — API Route, Changes Required
- **Detail**: Supabase JS `.insert()` returns `data: null` unless you chain `.select()`. Without it the route loses DB-generated `id` and `created_at` fields.
- **Fix**: Updated Phase 4 happy path to say `.insert([...]).select()` and note returned `data` is the `Flashcard[]`.
- **Decision**: FIXED

### F5 — `HTTP-Referer: ...` is an unresolved placeholder in Phase 3 contract

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Generation Service
- **Detail**: `HTTP-Referer: ...` placeholder left for implementer to guess.
- **Fix**: Replaced with explicit instruction: omit the header for MVP (OpenRouter does not require it).
- **Decision**: FIXED

### F6 — Partial-insert risk acknowledged in brief but absent from plan

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — API Route
- **Detail**: Brief flags that a `generations` row can persist with zero cards if the flashcards batch INSERT fails. Absent from plan.md.
- **Fix**: Added partial-insert note to Phase 4 contract with forward reference to S-02.
- **Decision**: FIXED
