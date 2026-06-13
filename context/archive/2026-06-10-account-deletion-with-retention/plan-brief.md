# Account Deletion with 30-Day Retention — Plan Brief

> Full plan: `context/changes/account-deletion-with-retention/plan.md`

## What & Why

Users need a self-service way to permanently delete their accounts, with data retained for 30 days before irreversible purge. This is linked to FR-001/FR-002 (auth lifecycle) and roadmap S-05. Without it, the only way to remove an account is via the Supabase dashboard.

## Starting Point

Three product tables (`generations`, `flashcards`, `review_logs`) already cascade-delete when `auth.users` is removed — meaning deletion today is already possible but immediate. There is no soft-delete mechanism, no service-role client, no cron/scheduler, and no settings UI. The middleware and auth patterns are solid and ready to build on.

## Desired End State

A logged-in user visits `/settings`, enters their email to confirm, and clicks Delete. Their session ends immediately and they cannot log back in. All their data becomes inaccessible via RLS. After 30 days a Supabase Edge Function running on a daily pg_cron schedule calls `auth.admin.deleteUser()`, which CASCADE-deletes everything. No cancel, no email notifications, no partial purge.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Soft-delete carrier | `profiles` table with `deleted_at` | Clean separation; no schema changes to product tables; RLS predicate is a single sub-select join | Plan |
| Scheduler for purge | Supabase Edge Function + pg_cron | Runs near DB; survives Workers redeploys; no Workers Secret for service role in purge path | Plan |
| Service-role key location | Workers Secret `SUPABASE_SERVICE_ROLE_KEY` | Consistent with existing `SUPABASE_KEY` pattern; needed for ban call from the Worker | Plan |
| Session on deletion | Sign out immediately + ban auth user | Simplest state model; no pending-deletion middleware gate needed | Plan |
| Reactivation | Not supported in this slice | Avoids cancel flow scope; safe MVP boundary | Plan |
| Data visibility during retention | Hidden immediately via RLS | Defense-in-depth; JWT stays valid up to 1 hour after ban, so RLS is required | Plan |
| UI entry point | New `/settings` page | Natural home for future account settings; standard web convention | Plan |
| Confirmation UX | Type email to confirm | Sufficient friction for an irreversible action without re-auth complexity | Plan |
| Email notifications | None | Supabase SMTP not yet configured; keeps scope tight | Plan |
| Same-email re-signup during window | Blocked naturally by Supabase | `auth.users` row still exists; Supabase rejects duplicate email with no extra code | Plan |
| `profiles` row sync | Postgres AFTER-INSERT trigger on `auth.users` | Cannot be missed regardless of signup path; standard Supabase pattern | Plan |

## Scope

**In scope:**
- `profiles` table migration + trigger + backfill
- Updated RLS on all three product tables (`deleted_at IS NULL` predicate)
- `SUPABASE_SERVICE_ROLE_KEY` Workers Secret + `src/lib/supabase-admin.ts` admin client factory
- `POST /api/account/delete` API route (ban + sign out + `deleted_at`)
- `/settings` Astro page + `DeleteAccountForm` React island + Topbar link
- `supabase/functions/purge-expired-accounts` Deno Edge Function
- pg_cron scheduling migration (daily 03:00 UTC)

**Out of scope:**
- Cancel-deletion flow
- Reactivation
- Email notifications (confirmation or reminder)
- Password re-authentication on confirm
- Workers Cron Trigger

## Architecture / Approach

```
User → /settings → DeleteAccountForm
          ↓ POST /api/account/delete
      Worker (anon + admin client):
        1. profiles.deleted_at = now()    ← anon client (RLS UPDATE)
        2. auth.admin.updateUser(ban)     ← service-role client
        3. supabase.auth.signOut()
          ↓
      User lands on /  (cannot sign back in)

Nightly (03:00 UTC):
  pg_cron → net.http_post → Edge Function (purge-expired-accounts)
    → SELECT id FROM profiles WHERE deleted_at <= now() - 30 days
    → auth.admin.deleteUser(id) × N
    → CASCADE: profiles, generations, flashcards, review_logs all gone
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB Foundation | `profiles` table, trigger, backfill, updated RLS on product tables | Backfill must not miss existing users; RLS sub-select adds join cost |
| 2. Service-role client & delete API | `SUPABASE_SERVICE_ROLE_KEY` secret, admin client, `POST /api/account/delete` | Service-role key exposure must stay server-only; ban must fire before sign-out |
| 3. Settings UI | `/settings` page, `DeleteAccountForm`, Topbar link | Email-confirm UX must block accidental deletion; client island routing on success |
| 4. Purge Edge Function | Deno function + pg_cron schedule | `net` extension must be enabled on hosted Supabase; pg_cron URL config for `app.supabase_url` |

**Prerequisites:** `gate-product-routes` (F-01) complete — it is. `SUPABASE_SERVICE_ROLE_KEY` must be added as a Workers Secret (`wrangler secret put`) and as a Supabase Edge Function secret before Phase 2 and Phase 4 respectively.

**Estimated effort:** ~3-4 sessions across 4 phases.

## Open Risks & Assumptions

- `pg_cron` and the `net` extension must be enabled on the hosted Supabase project. If not, the fallback is Supabase Dashboard → Edge Functions → Schedule (no migration needed) — document this before Phase 4 begins.
- `app.supabase_url` and `app.supabase_service_role_key` custom settings required by the pg_cron migration need to be pre-configured in the Supabase DB settings; the plan includes an alternative (Dashboard scheduling) if this is blocked.
- Existing users without `profiles` rows are handled by the backfill INSERT, but the window between migration deploy and first request is covered by `ON CONFLICT DO NOTHING`.
- Supabase ban (`ban_duration: '876000h'`) prevents token refresh but not the use of an existing unexpired JWT (up to 3600s). The RLS `deleted_at IS NULL` predicate closes this window.

## Success Criteria (Summary)

- A user can request account deletion via `/settings`, be immediately signed out, and be unable to sign back in.
- Product data is inaccessible via the API immediately after deletion is requested.
- After seeding a test user with a 31-day-old `deleted_at`, the Edge Function removes the `auth.users` row and all cascaded product data.
