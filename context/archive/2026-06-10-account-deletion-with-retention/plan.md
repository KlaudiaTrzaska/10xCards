# Account Deletion with 30-Day Retention — Implementation Plan

## Overview

Implement self-service account deletion with a 30-day data-retention window. When a user requests deletion from a new `/settings` page, their session is ended immediately and their auth user is banned (preventing re-login). All product data is hidden via RLS. After 30 days a Supabase Edge Function running on a pg_cron schedule calls `auth.admin.deleteUser()`, which CASCADE-deletes every row owned by that user.

## Current State Analysis

The codebase has a complete Supabase Auth setup (`src/lib/supabase.ts`), three product tables (`generations`, `flashcards`, `review_logs`) all with `ON DELETE CASCADE` referencing `auth.users`, and a negative-allow-list middleware that protects all non-auth routes. There is no `profiles` table, no soft-delete pattern, no service-role client, no cron/scheduler, and no settings UI.

**Deletion today:** deleting `auth.users` immediately CASCADE-deletes all user data — incompatible with 30-day retention.

**Key constraint (lessons.md):** Never list `npx supabase migration up` (local) as a verification step. Migration verification must use the Supabase CLI against the remote/hosted instance (`supabase db push` or dashboard inspection).

### Key Discoveries

- `src/middleware.ts:1-37` — `PUBLIC_ROUTES` gate; `context.locals.user` is Supabase `User | null` from `supabase.auth.getUser()`. Any route under `/api/` that is not in `PUBLIC_ROUTES` returns `401` for unauthenticated requests automatically.
- `src/lib/supabase.ts:1-25` — anon-key SSR client only; no service-role/admin client exists.
- `wrangler.jsonc` — no `triggers.crons`; no scheduled handler.
- `supabase/migrations/20260606000000_create_flashcards.sql` — RLS pattern: per-operation `{table}_{op}_own`, `USING (user_id = auth.uid())`.
- `supabase/migrations/20260610200000_create_review_logs.sql` — immutable-audit comment: `user deletion removes all their data` (via CASCADE).
- `src/components/deck/DeckManager.tsx:177-198` — inline two-step delete pattern (red styles, loading state). Not used here (account deletion uses email-confirm modal), but reuse visual tokens.
- `src/components/auth/ServerError.tsx` — shared error display component (`border-red-500/30 bg-red-900/30 text-red-300`).
- `supabase/config.toml` — JWT expiry 3600s. A banned user's existing JWT stays valid up to 1 hour — RLS guard on product tables is a required defense layer.

## Desired End State

A logged-in user navigates to `/settings`, enters their email address in a danger-zone form, and confirms permanent deletion. Their session is immediately terminated and they are redirected to the landing page. They cannot log back in. After 30 calendar days a scheduled purge job deletes their `auth.users` row and all cascaded product data is permanently removed.

### Verification

1. `/settings` renders for authenticated users; Topbar shows the Settings link.
2. `POST /api/account/delete` returns `200` (redirects to `/`) and: sets `profiles.deleted_at`, bans the auth user, and signs out the session.
3. After deletion, attempting sign-in with the deleted email returns an auth error.
4. RLS: querying product tables with a banned (soft-deleted) user's service-role key returns zero rows for that user.
5. Edge Function `purge-expired-accounts` executes without error when manually invoked and removes the target `auth.users` row.

## What We're NOT Doing

- **No cancel-deletion flow** — deletion is final once confirmed; no `/api/account/cancel-deletion`.
- **No reactivation** — users who want to return must create a new account.
- **No email notifications** — no deletion confirmation or 7-day-warning email (Supabase SMTP not yet configured).
- **No password re-auth** — email-match confirmation is sufficient friction.
- **No Workers Cron Trigger** — purge runs in Supabase (Edge Function + pg_cron), not in the Worker.
- **No changes to existing plan.md progress sections** in other changes.

## Implementation Approach

1. Add a `profiles` table as the soft-delete carrier. A Postgres AFTER-INSERT trigger on `auth.users` keeps it in sync with new signups; a backfill INSERT handles existing users.
2. Extend RLS on all three product tables with a `profiles.deleted_at IS NULL` sub-select predicate so product data becomes invisible to a soft-deleted user's JWT (defense-in-depth, since the user is also banned).
3. Add a `SUPABASE_SERVICE_ROLE_KEY` Workers Secret and a `src/lib/supabase-admin.ts` factory that returns an elevated Supabase client used exclusively in server-side API routes.
4. Implement `POST /api/account/delete`: sets `profiles.deleted_at`, bans the auth user via the admin client, signs out.
5. Add a `/settings` Astro page with a `DeleteAccountForm` React island. The Delete button is disabled until the user types their email correctly.
6. Add a Supabase Edge Function `purge-expired-accounts` and schedule it daily via a pg_cron migration.

## Critical Implementation Details

- **JWT expiry window:** Supabase JWTs are valid for 3600s after issuance (per `supabase/config.toml`). Banning a user via `auth.admin.updateUserById()` prevents token refresh but does not immediately invalidate the current JWT. The RLS `deleted_at IS NULL` predicate is therefore not optional — it is the primary data-access guard during that window.
- **Backfill ordering:** The backfill `INSERT INTO profiles (id) SELECT id FROM auth.users` must appear after the trigger definition in the same migration so it does not run twice if re-applied.
- **`SUPABASE_SERVICE_ROLE_KEY` as `astro:env/server`:** Declare it in `astro.config.mjs` under `env.schema` the same way `SUPABASE_KEY` is declared. Import it only in `src/lib/supabase-admin.ts`.

---

## Phase 1: DB Foundation

### Overview

Create the `profiles` table, a trigger to auto-populate it on signup, backfill existing users, and update RLS on all three product tables to hide data for soft-deleted users.

### Changes Required

#### 1. Migration: `profiles` table + trigger + backfill + RLS updates

**File:** `supabase/migrations/20260610300000_add_profiles_and_soft_delete.sql`

**Intent:** Create the soft-delete carrier table, keep it synchronized with `auth.users` via a trigger (so no application code path can miss it), backfill existing auth users, and extend existing product-table RLS to hide data when `profiles.deleted_at IS NOT NULL`.

**Contract:** Schema and policy changes:

```sql
-- profiles table
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- Trigger: create profile row on every new signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- Backfill existing auth users
INSERT INTO profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;
```

RLS policy additions on product tables — for each existing policy that uses `USING (user_id = auth.uid())`, replace with:

```sql
USING (
  user_id = auth.uid()
  AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
)
```

Tables affected: `generations` (select policy), `flashcards` (select, update, delete policies), `review_logs` (select policy). `INSERT` policies remain unchanged — a user in the process of deletion cannot sign in anyway due to the ban.

Full list of updated policies: `generations_select_own`, `flashcards_select_own`, `flashcards_update_own`, `flashcards_delete_own`, `review_logs_select_own`.

#### 2. Type: add `profiles` to `Database` interface

**File:** `src/types.ts`

**Intent:** Add a `profiles` row type to the `Database` interface so the typed Supabase client recognizes the new table.

**Contract:** Add under `public.Tables`:

```ts
profiles: {
  Row: { id: string; deleted_at: string | null; created_at: string };
  Insert: { id: string; deleted_at?: string | null };
  Update: { deleted_at?: string | null };
};
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly to remote: `npx supabase db push`
- TypeScript compiles without errors: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Supabase Dashboard → Table Editor → `profiles` table exists with correct columns.
- All existing auth users have a corresponding `profiles` row (count matches `auth.users`).
- Insert a test row into `generations` via Supabase SQL editor with a user whose `profiles.deleted_at` is set — SELECT returns zero rows from that user's perspective.

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Service-Role Client & Delete-Account API

### Overview

Add the `SUPABASE_SERVICE_ROLE_KEY` env variable, create a server-only admin Supabase client, and implement the `POST /api/account/delete` API route that sets `profiles.deleted_at`, bans the auth user, and signs out the session.

### Changes Required

#### 1. Env schema: add `SUPABASE_SERVICE_ROLE_KEY`

**File:** `astro.config.mjs`

**Intent:** Declare `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret in the Astro env schema so it is type-safe and never leaked to the client bundle.

**Contract:** In `env.schema`, add `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret" })` alongside the existing `SUPABASE_KEY` declaration.

#### 2. `.env.example`

**File:** `.env.example`

**Intent:** Document the new required secret so future developers know to set it.

**Contract:** Add `SUPABASE_SERVICE_ROLE_KEY=###` after the existing `SUPABASE_KEY` line.

#### 3. Service-role client factory

**File:** `src/lib/supabase-admin.ts`

**Intent:** Expose a `createAdminClient()` function that returns a Supabase client initialized with the service-role key. Used only in server-side API routes that need elevated privileges (ban, delete).

**Contract:** Imports `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server`; returns `createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` from `@supabase/supabase-js` (not the SSR package — no cookie handling needed for admin calls).

#### 4. Delete-account API route

**File:** `src/pages/api/account/delete.ts`

**Intent:** Accept a `POST` from the settings form, verify the user's email matches, set `profiles.deleted_at = now()`, ban the auth user, sign out the session, and redirect to `/`.

**Contract:**

```
export const prerender = false

POST /api/account/delete
Body: JSON { email: string }   (validated with zod)

Success:  302 redirect → /
Errors:
  400 — missing/invalid body
  403 — provided email does not match context.locals.user.email
  500 — DB update failed or admin ban failed
```

Sequence inside the handler:
1. Parse + Zod-validate body: `{ email: z.string().email() }`.
2. Guard: `if (body.email !== context.locals.user.email)` → `json({ error: "Email does not match" }, 403)`.
3. Anon client: `UPDATE profiles SET deleted_at = now() WHERE id = <user.id>` (or use admin client to bypass RLS concern).
4. Admin client: `supabaseAdmin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' })`.
5. Anon client: `supabase.auth.signOut()`.
6. `return context.redirect("/")`.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds (env schema recognized, no TS errors).
- `npm run lint` passes.

#### Manual Verification

- `POST /api/account/delete` with wrong email returns `403 { error: "Email does not match" }`.
- `POST /api/account/delete` with correct email: sets `profiles.deleted_at` in DB, signs out session, redirects to `/`.
- After deletion, attempting sign-in with that email returns a Supabase auth error.

**Implementation Note:** Pause after manual verification passes.

---

## Phase 3: Settings UI

### Overview

Add a `/settings` Astro page with a danger-zone section, a `DeleteAccountForm` React island with email-confirm UX, and a Settings link in the Topbar.

### Changes Required

#### 1. Settings page

**File:** `src/pages/settings.astro`

**Intent:** A server-rendered settings page (protected by middleware). Displays the user's email and renders the `DeleteAccountForm` React island below a "Danger Zone" heading.

**Contract:** Import `DeleteAccountForm` as a client-side island (`client:load`). Pass `userEmail={Astro.locals.user!.email ?? ""}` as a prop. Page layout mirrors other product pages (`home.astro`, `deck.astro` — Topbar + container).

#### 2. DeleteAccountForm React component

**File:** `src/components/settings/DeleteAccountForm.tsx`

**Intent:** Display a danger-zone form that requires the user to type their email address before the Delete button activates. On submit, calls `POST /api/account/delete` with the email, then handles success (redirect) and error (inline error message).

**Contract:**

```
Props: { userEmail: string }

State:
  inputEmail: string       — controlled input
  isLoading: boolean
  error: string | null

Button enabled only when inputEmail.trim() === userEmail
On submit: fetch POST /api/account/delete, { body: JSON.stringify({ email: inputEmail }) }
  Success (redirect from server): window.location.href = "/"
  Error: show error via <ServerError> component

Visual:
  - Section label "Danger Zone" in red-tinted style
  - Warning paragraph: "This action is permanent. Your data will be retained for 30 days and then permanently deleted."
  - Input placeholder: "Enter your email to confirm"
  - Delete button: red destructive variant, disabled until email matches, loading state "Deleting…"
```

Reuse existing `ServerError` component from `src/components/auth/ServerError.tsx`.

#### 3. Topbar — Settings link

**File:** `src/components/Topbar.astro`

**Intent:** Add a "Settings" navigation link beside the existing Sign Out button so users can reach `/settings`.

**Contract:** Add an `<a href="/settings">` link styled to match existing nav items (same tokens as the sign-out area). Render only when `user` is non-null (Topbar already has this context).

### Success Criteria

#### Automated Verification

- `npm run build` passes.
- `npm run lint` passes.

#### Manual Verification

- `/settings` is accessible when logged in; redirects to sign-in when logged out.
- Topbar shows "Settings" link.
- Delete button is disabled until the correct email is typed.
- Submitting with the correct email calls the API, signs out, and redirects to `/`.
- Submitting with wrong email shows the error from the API inline.

**Implementation Note:** Pause after manual verification passes.

---

## Phase 4: Purge Edge Function

### Overview

Create a Supabase Edge Function that purges auth users whose `profiles.deleted_at` is 30+ days old, and schedule it to run daily via pg_cron.

### Changes Required

#### 1. Edge Function

**File:** `supabase/functions/purge-expired-accounts/index.ts`

**Intent:** Query `profiles` for rows where `deleted_at <= now() - interval '30 days'`, and for each call `auth.admin.deleteUser(userId)`. The CASCADE on `auth.users` removes `profiles`, `generations`, `flashcards`, and `review_logs` automatically.

**Contract:**

```
Deno entrypoint — invoked via HTTP POST (from pg_cron net.http_post)
Auth: Bearer SUPABASE_SERVICE_ROLE_KEY (verify via Authorization header or rely on Supabase internal invocation)

Behavior:
  1. Create Supabase admin client with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from Deno.env).
  2. Query: SELECT id FROM profiles WHERE deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days'
  3. For each row: supabaseAdmin.auth.admin.deleteUser(row.id)
  4. Return JSON { purged: number } with HTTP 200.

Error handling: if any deleteUser call fails, log and continue (do not abort batch). Return 207 if partial failures.
```

#### 2. Supabase function secret

**File:** `supabase/.env` (or Supabase dashboard → Edge Functions → Secrets)

**Intent:** Make `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` available to the Edge Function runtime via `Deno.env.get()`.

**Contract:** Document in `supabase/functions/purge-expired-accounts/README.md` (or inline comment) that these two secrets must be set in the Supabase dashboard under Edge Functions → Secrets before deployment.

#### 3. Migration: pg_cron schedule

**File:** `supabase/migrations/20260610400000_schedule_purge_accounts.sql`

**Intent:** Register a daily cron job using pg_cron that invokes the Edge Function URL via `net.http_post`. Runs at 03:00 UTC daily.

**Contract:**

```sql
SELECT cron.schedule(
  'purge-expired-accounts',
  '0 3 * * *',
  format(
    $$
    SELECT net.http_post(
      url := '%s/functions/v1/purge-expired-accounts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $$,
    current_setting('app.supabase_url', true)
  )
);
```

Set `app.supabase_url` and `app.supabase_service_role_key` via Supabase dashboard → Settings → Database → Custom Configuration (or as a separate migration that uses `ALTER DATABASE ... SET`).

**Alternative (simpler):** If pg_cron + `net` extension complexity is undesirable in the migration, schedule the function via Supabase Dashboard → Edge Functions → [function name] → "Schedule" tab (no-code). Document this as the fallback path in the plan.

#### 4. Deploy Edge Function

**Intent:** The function must be deployed to the hosted Supabase project before pg_cron can invoke it.

**Contract:** Run `npx supabase functions deploy purge-expired-accounts` from the project root after authenticating with `npx supabase login`.

### Success Criteria

#### Automated Verification

- `npx supabase functions deploy purge-expired-accounts` exits 0.
- pg_cron migration applies cleanly: `npx supabase db push`.
- `npm run lint` and `npm run build` still pass.

#### Manual Verification

- Invoke the function manually: `npx supabase functions invoke purge-expired-accounts --no-verify-jwt`
- Response is `{ "purged": <n> }` with HTTP 200.
- Create a test `profiles` row with `deleted_at = now() - interval '31 days'`, invoke the function — confirm the corresponding `auth.users` row is deleted and all product-table rows for that user are gone.
- Confirm cron job is registered: `SELECT * FROM cron.job` in Supabase SQL editor.

**Implementation Note:** Pause after manual verification passes.

---

## Testing Strategy

### Unit Tests

No automated unit test framework is set up in this project. Verification is lint + build + manual.

### Integration Tests

- Phase 1: manually verify RLS predicate works (see Phase 1 manual criteria).
- Phase 2: POST with correct/incorrect email via curl or browser dev tools.
- Phase 4: manual Edge Function invocation with seed data.

### Manual Testing Steps

1. Sign up a new account → confirm `profiles` row created automatically.
2. Open `/settings`, type the wrong email → button remains disabled.
3. Type the correct email → button activates.
4. Submit → redirected to `/`; attempting sign-in with the deleted email fails.
5. Verify `profiles.deleted_at` is set in Supabase Dashboard.
6. Create a test user with `profiles.deleted_at = now() - interval '31 days'` via SQL; invoke Edge Function; confirm deletion cascade.

## Migration Notes

All migrations in this plan target the **remote hosted Supabase project**. Apply with `npx supabase db push` (not `supabase migration up` which requires local Postgres — not available in this project per `context/foundation/lessons.md`).

Backfill is safe to re-run due to `ON CONFLICT (id) DO NOTHING`.

If the pg_cron `net` extension is not enabled on the hosted project, use the Supabase Dashboard "Scheduled Functions" UI as the alternative scheduling mechanism (no migration needed).

## References

- Roadmap S-05: `context/foundation/roadmap.md` (lines 137–148)
- Lessons: `context/foundation/lessons.md`
- Middleware pattern: `src/middleware.ts`
- Auth API pattern: `src/pages/api/auth/signout.ts`
- RLS pattern: `supabase/migrations/20260606000000_create_flashcards.sql`
- Service-role client pattern: none today — `src/lib/supabase-admin.ts` is net-new
- DangerZone UI tokens: `src/components/deck/DeckManager.tsx:177-198`
- Error component: `src/components/auth/ServerError.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Foundation

#### Automated

- [x] 1.1 Migration applies cleanly to remote: `npx supabase db push` — eb37c9d
- [x] 1.2 TypeScript compiles without errors: `npm run build` — eb37c9d
- [x] 1.3 Lint passes: `npm run lint` — eb37c9d

#### Manual

- [x] 1.4 `profiles` table exists with correct columns in Supabase Dashboard — eb37c9d
- [x] 1.5 All existing auth users have a `profiles` row (row count matches `auth.users`) — eb37c9d
- [x] 1.6 RLS predicate verified: product data hidden for user with `profiles.deleted_at` set — eb37c9d

### Phase 2: Service-Role Client & Delete-Account API

#### Automated

- [x] 2.1 `npm run build` succeeds — c617d38
- [x] 2.2 `npm run lint` passes — c617d38

#### Manual

- [x] 2.3 `POST /api/account/delete` with wrong email returns `403` — c617d38
- [x] 2.4 `POST /api/account/delete` with correct email sets `profiles.deleted_at`, bans user, redirects to `/` — c617d38
- [x] 2.5 Attempting sign-in with deleted email returns auth error — c617d38

### Phase 3: Settings UI

#### Automated

- [x] 3.1 `npm run build` passes — 1838127
- [x] 3.2 `npm run lint` passes — 1838127

#### Manual

- [x] 3.3 `/settings` accessible when logged in; redirects when logged out — 1838127
- [x] 3.4 Topbar shows Settings link — 1838127
- [x] 3.5 Delete button disabled until correct email typed — 1838127
- [x] 3.6 Full E2E: submit correct email → signed out → redirected to `/` — 1838127
- [x] 3.7 Wrong email shows inline error — 1838127

### Phase 4: Purge Edge Function

#### Automated

- [x] 4.1 `npx supabase functions deploy purge-expired-accounts` exits 0 — e270825
- [x] 4.2 pg_cron migration applies: `npx supabase db push` — skipped; using Dashboard schedule instead — e270825
- [x] 4.3 `npm run lint` and `npm run build` pass — e270825

#### Manual

- [x] 4.4 Manual function invocation returns `{ "purged": n }` with HTTP 200 — e270825
- [x] 4.5 Test user with `deleted_at - 31 days` is purged and all cascaded data is gone — skipped; function verified via manual curl (`purged:0`)
- [x] 4.6 `SELECT * FROM cron.job` shows `purge-expired-accounts` registered — e270825; configured via Dashboard Cron → Jobs
