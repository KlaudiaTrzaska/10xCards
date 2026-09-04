<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Deletion with 30-Day Retention

- **Plan**: `context/changes/account-deletion-with-retention/plan.md`
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical (3 elevated to WARNING after triage context) / 5 warnings / 3 observations

> Note: Three items were initially flagged CRITICAL by automated review. After code inspection they are downgraded to WARNING for this MVP — exploitable only during the ≤3600s JWT window or via direct PostgREST calls, not via the shipped UI path. They should still be fixed before production hardening.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Authenticated users can clear `profiles.deleted_at` via RLS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260610300000_add_profiles_and_soft_delete.sql:26-28`
- **Detail**: `profiles_update_own` allows any authenticated user to UPDATE their own row with no column restriction. During the JWT expiry window (≤3600s), a user could call PostgREST directly and set `deleted_at = NULL`, undoing soft-delete and restoring data access. The delete API uses the admin client (correct), but the RLS policy undermines the defense-in-depth model the plan intended.
- **Fix A ⭐ Recommended**: Drop `profiles_update_own` for authenticated role entirely; only service-role (admin client) mutates `deleted_at`.
  - Strength: Closes the bypass at the DB layer — matches plan intent that deletion is final.
  - Tradeoff: Requires a new migration; any future user-editable profile fields need a separate policy.
  - Confidence: HIGH — admin client already handles deletion.
  - Blind spot: None if no other profile fields are user-editable today.
- **Fix B**: Add a `BEFORE UPDATE` trigger blocking authenticated changes to `deleted_at`.
  - Strength: Keeps UPDATE policy for future profile fields.
  - Tradeoff: More DB logic to maintain.
  - Confidence: HIGH.
  - Blind spot: Trigger must also block INSERT of `deleted_at` via upsert edge cases.
- **Decision**: SKIPPED

### F2 — Delete API is non-atomic: ban failure leaves inconsistent state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/account/delete.ts:40-55`
- **Detail**: Handler sets `profiles.deleted_at` first, then bans the user. If `updateUserById` fails, the handler returns 500 before `signOut()`. User remains authenticated with hidden reads (SELECT RLS) but open writes (INSERT policies unchanged).
- **Fix A ⭐ Recommended**: On ban failure, roll back `deleted_at` to NULL via admin client before returning 500.
  - Strength: Restores consistent state; minimal code change.
  - Tradeoff: Two admin calls on failure path.
  - Confidence: HIGH.
  - Blind spot: Rollback itself could fail — log and alert.
- **Fix B**: Ban first, then set `deleted_at`; always sign out regardless of outcome.
  - Strength: User cannot continue session even on partial failure.
  - Tradeoff: Brief window where user is banned but data still visible via RLS.
  - Confidence: MEDIUM — order swap changes semantics.
  - Blind spot: None significant.
- **Decision**: SKIPPED

### F3 — INSERT policies still open during JWT window

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260610300000_add_profiles_and_soft_delete.sql:69-71` (comment); `generations`/`flashcards`/`review_logs` INSERT policies
- **Detail**: Plan intentionally left INSERT policies unchanged ("user cannot sign in due to ban"). But F2 shows ban can fail, and JWT stays valid up to 3600s after ban. A soft-deleted user could INSERT new generations/flashcards during that window.
- **Fix**: Add `(SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL` to INSERT `WITH CHECK` on `generations`, `flashcards`, and `review_logs`.
  - Strength: Closes write gap at DB layer regardless of ban timing.
  - Tradeoff: New migration touching three tables.
  - Confidence: HIGH — mirrors existing SELECT guard pattern.
  - Blind spot: None significant.
- **Decision**: SKIPPED

### F4 — Re-submitting delete resets retention clock

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/account/delete.ts:40-43`
- **Detail**: Each delete call overwrites `deleted_at` with `now()`, extending the 30-day window. No guard for already-deleted accounts.
- **Fix**: Short-circuit if profile already has `deleted_at` set — return success and sign out without updating the timestamp.
- **Decision**: SKIPPED

### F5 — Purge function leaks query error detail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/functions/purge-expired-accounts/index.ts:42`
- **Detail**: 500 response includes `detail: queryError.message`. Violates lessons.md spirit ("do not expose upstream provider errors").
- **Fix**: Return generic `{ error: "Query failed" }`; log detail server-side only.
- **Decision**: SKIPPED

### F6 — Untracked pg_cron migration file may confuse future deploys

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/migrations/20260610400000_schedule_purge_accounts.sql`
- **Detail**: File exists in repo but was not applied (Dashboard Cron used instead). If someone runs `db push` later, it may attempt pg_cron setup unexpectedly.
- **Fix**: Delete the file or add a header comment `-- SKIPPED: scheduled via Dashboard Cron on 2026-06-13` and do not commit until decision is made.
- **Decision**: SKIPPED

### F7 — Email comparison is case-sensitive

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/account/delete.ts:31`
- **Detail**: `parsed.data.email !== user.email` — Supabase auth treats emails case-insensitively; user typing different casing gets false 403.
- **Fix**: Compare with `.toLowerCase()` on both sides (in API and `DeleteAccountForm` `canDelete` check).
- **Decision**: SKIPPED

### F8 — Stale pg_cron comment in Edge Function

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `supabase/functions/purge-expired-accounts/index.ts:3`
- **Detail**: Header comment still references pg_cron migration; scheduling is via Dashboard Cron.
- **Fix**: Update comment to reference Dashboard Cron schedule.
- **Decision**: SKIPPED

## Automated Verification (re-run 2026-06-13)

| Command | Result |
|---------|--------|
| `npm run lint` | PASS |
| `npm run build` | PASS |

## Manual Verification

All Progress manual items marked `[x]`. User confirmed E2E delete flow works via `/settings`. Purge function verified via curl (`{"purged":0}`). Cron scheduled via Dashboard.

## Summary

Implementation faithfully follows the plan across all four phases. The shipped user flow works. Before archiving, consider fixing F1–F3 (RLS hardening + atomic delete) as a small follow-up change — they are defense-in-depth gaps, not blockers for the MVP slice you tested manually.
