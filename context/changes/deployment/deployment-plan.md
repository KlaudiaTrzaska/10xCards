# Cloudflare Workers — Integration & Deployment Plan

**Project:** 10xCards  
**Platform:** Cloudflare Workers (Workers Assets model via `@astrojs/cloudflare` v13+)  
**Wrangler:** v4.97.0  
**Reference:** `context/foundation/infrastructure.md`  
**Created:** 2026-06-03

---

## Status — 2026-06-05 (updated 11:57)

| Phase | Status | Notes |
|---|---|---|
| Prerequisites | ✅ Done | Core tooling, Cloudflare account, Supabase project, credentials all configured |
| Phase 0 — Pre-flight | ✅ Done | Worker renamed to `10xcards`, KV namespace created, build clean |
| Phase 1 — Auth & token | ✅ Done | Wrangler authenticated, scoped API token created |
| Phase 2 — Workers Secrets | ✅ Done | `SUPABASE_URL` + `SUPABASE_KEY` pushed to Workers |
| Phase 3 — First manual deploy | ✅ Done | Live at https://10xcards.bialczyk-klaudia91.workers.dev |
| Phase 4 — Workers Builds CD | ✅ Done | Auto-deploy on push to `main` connected and verified |
| **App deployed on Cloudflare** | ✅ **Confirmed 2026-06-05** | |
| Phase 5 — Custom domain | ⬜ Pending | |
| Phase 6 — Preview URL security | ⬜ Pending | |
| Phase 7 — Log retention | ⬜ Pending | |
| Phase 8 — Workers Standard | ⬜ Pending | Benchmark CPU before going live with real users |
| Phase 9 — Rollback procedures | 🔶 Partial | Rollback command documented; migration rule not yet added to `AGENTS.md`/`CLAUDE.md`; rollback not yet tested |
| Phase 10 — Post-launch monitoring | ⬜ Pending | |

> **Open known issue:** Workers Builds logs a warning about Worker name mismatch (`10x-astro-starter` in the generated `dist/server/wrangler.json` vs `10xcards` expected by CI). Cloudflare said it would auto-open a PR to fix this — check GitHub for that PR and merge it when it appears.

---

## Current State Snapshot

| Item | Status | Notes |
|---|---|---|
| `@astrojs/cloudflare` v13+ | ✅ Installed (v13.5.0) | Correct adapter for Astro 6 Workers |
| `wrangler` v4 | ✅ Installed (v4.97.0) | Updated from v4.90.0 |
| `wrangler.jsonc` | ✅ Configured | Worker name `10xcards`, KV namespace wired, `nodejs_compat` set |
| `nodejs_compat` flag | ✅ Set | Required for Supabase JS SDK |
| `observability.enabled` | ✅ Set | Cloudflare dashboard metrics enabled |
| `compatibility_date` | ✅ `2026-05-08` | Recent; no immediate update needed |
| `imageService` | ✅ `passthrough` | Cloudflare Images disabled (not needed for MVP) |
| SESSION KV namespace | ✅ Created | ID `1e914c9b0b3346369e25022b58c789de` — bound but idle (app uses Supabase auth) |
| CI (lint + build) | ✅ `.github/workflows/ci.yml` | Targets `main` branch; quality gate only — no deploy step (intentional) |
| Production deploy | ✅ Live | https://10xcards.bialczyk-klaudia91.workers.dev |
| Workers Builds CD | ✅ Connected | Auto-deploys on push to `main`; build + deploy commands configured |
| Workers Secrets | ✅ Pushed | `SUPABASE_URL` + `SUPABASE_KEY` set in Workers Secrets store |
| Build-time env vars | ✅ Set | `SUPABASE_URL` + `SUPABASE_KEY` added as encrypted vars in Workers Builds UI |
| `.dev.vars` | ✅ Created | Local dev credentials set; gitignored |
| Custom domain | ❌ Not configured | |
| Log retention | ❌ Not configured | Live-only `wrangler tail` by default |
| Preview URL protection | ❌ Not configured | Public `*.workers.dev` by default |
| Workers Standard plan | ❌ Not upgraded | Free tier (10ms CPU limit) — upgrade before real traffic |

---

## Prerequisites

Complete all items here before starting Phase 0. These are one-time setup steps for CLI tools and external accounts.

### A — Node.js & Package Manager

- [x] **P.1** Confirm Node.js version is 22:
  ```bash
  node --version   # must be v22.x.x
  ```
  If not, install via nvm:
  ```bash
  nvm install 22 && nvm use 22
  ```
  The project ships an `.nvmrc` — `nvm use` (no argument) will pick it up automatically.

### B — Cloudflare Account & Dashboard Configuration

- [x] **P.2** Create a Cloudflare account if you don't have one:
  - [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) — free account is sufficient to start.
  - Use a real email address — Cloudflare sends deployment notifications and billing alerts to it.
- [x] **P.3** Enable **Workers & Pages** on your account:
  - Dashboard → **Workers & Pages** (left sidebar) — on first visit, it will prompt you to set a `*.workers.dev` subdomain (e.g. `10xcards`).
  - This subdomain is permanent and account-wide — choose it carefully.
  - ⚠️ The subdomain cannot be changed after it's set. If `10xcards.workers.dev` is taken, try `10xcardsapp` or similar.
- [ ] **P.4** (If using a custom domain) Add your domain to Cloudflare:
  - Dashboard → **Add a Site** → enter your domain (e.g. `10xcards.com`) → choose the **Free** plan.
  - Cloudflare will scan existing DNS records and import them automatically.
  - Update your domain registrar's nameservers to the two Cloudflare nameservers shown (e.g. `ada.ns.cloudflare.com`, `brad.ns.cloudflare.com`).
  - ⚠️ DNS propagation can take up to 24 hours, though it's typically under 30 minutes. The Cloudflare dashboard shows a **"Active"** badge once propagation completes.
  - ⚠️ If your domain is already on Cloudflare from a previous project, skip this step — the domain is already configured.
- [ ] **P.5** Verify the domain shows **"Active"** status:
  - Dashboard → **Websites** → your domain → status badge should be green/Active.
  - If still Pending after 24 hours: confirm nameserver change at your registrar (use `dig NS yourdomain.com` to check which nameservers are live).
- [ ] **P.6** Configure **automatic HTTPS** (should be on by default):
  - Dashboard → your domain → **SSL/TLS** → mode should be **Full (strict)** for production.
  - ⚠️ If SSL mode is set to "Flexible", Cloudflare terminates TLS at the edge but connects to origin over plain HTTP — not applicable for Workers (Workers terminate at the edge natively), but check this if you ever add a custom origin.
- [ ] **P.7** Enable **Always Use HTTPS**:
  - Dashboard → your domain → **SSL/TLS** → **Edge Certificates** → toggle **Always Use HTTPS** → On.
  - This redirects all `http://` requests to `https://` at the Cloudflare edge before they reach your Worker.
- [x] **P.8** Create a scoped **API Token** for Workers Builds and CLI operations:
  - Dashboard → top-right avatar → **My Profile** → **API Tokens** → **Create Token**
  - Select the **"Edit Cloudflare Workers"** template
  - Adjust permissions:
    - `Account > Workers Scripts > Edit` ✅
    - `Zone > Workers Routes > Edit` ✅ (only if using custom domain routing)
    - Remove any zones you don't own
  - Under **Account Resources**: select your specific account (not "All accounts")
  - Under **Zone Resources**: select your specific zone/domain (not "All zones")
  - Set a **TTL** (expiry) — 1 year is reasonable for a personal project; shorter for teams.
  - Click **Continue to summary** → **Create Token** → copy the value immediately (shown once only).
  - ⚠️ Store this token in a password manager — it's needed for Phase 1 and Workers Builds setup.
- [ ] **P.9** (Optional) Enable **Cloudflare Notifications** for your Worker:
  - Dashboard → **Notifications** → **Add** → select **Workers Usage Model** or **Workers Error Rate**
  - Set an alert threshold (e.g. error rate > 5% for 5 minutes) and a notification email.
  - ⚠️ This is free and takes 2 minutes — worth doing before your first real deploy so you're not flying blind.

### C — Wrangler CLI

Wrangler is already a dev dependency (`wrangler` v4.97.0 in `package.json`). No global install needed — always invoke via `npx wrangler` or add scripts to `package.json`.

- [x] **P.10** Verify wrangler is resolvable:
  ```bash
  npx wrangler --version   # should print 4.x.x
  ```
- [x] **P.11** Authenticate wrangler with your Cloudflare account:
  ```bash
  npx wrangler login
  ```
  A browser window opens for OAuth. On success, credentials are written to `~/.config/.wrangler/config/default.toml`.
- [x] **P.12** Confirm authentication and note your Account ID:
  ```bash
  npx wrangler whoami
  ```
  Output example:
  ```
  Getting User settings...
  👋 You are logged in with an OAuth Token, associated with the email 'you@example.com'!
  ┌──────────────────────┬──────────────────────────────────┐
  │ Account Name         │ Account ID                       │
  ├──────────────────────┼──────────────────────────────────┤
  │ Your Account         │ abc123...                        │
  └──────────────────────┴──────────────────────────────────┘
  ```
  Save the **Account ID** — you'll need it when connecting Workers Builds to GitHub (Phase 4).
  - ⚠️ If you have multiple Cloudflare accounts, `wrangler` uses the first one by default. Pin it explicitly:
    ```bash
    export CLOUDFLARE_ACCOUNT_ID=abc123...
    ```
    Add this to your shell profile (`.zshrc`) so it persists across sessions.

### D — Supabase Project

- [x] **P.13** Create a Supabase account if you don't have one: [https://supabase.com](https://supabase.com)
- [x] **P.14** Create a new Supabase **production** project:
  - Dashboard → New project → choose a region close to your users (Cloudflare Workers is globally distributed; pick the region where most users will be, e.g. `eu-west-1` for Europe).
  - Set a strong database password and save it in a password manager.
  - ⚠️ The free Supabase tier (2 projects) pauses a project after 7 days of inactivity. For production use, upgrade to the Pro plan ($25/month) before launch or keep the project active during development.
- [x] **P.15** Retrieve the production project credentials:
  - Supabase Dashboard → Project Settings → API
  - Copy **Project URL** → this is `SUPABASE_URL`
  - Copy **anon / public key** → this is `SUPABASE_KEY`
  - ⚠️ Never use the `service_role` key in the app — it bypasses Row Level Security. Only use the `anon` key on the client/SSR side.
- [x] **P.16** Set up local development credentials:
  ```bash
  cp .env.example .dev.vars
  ```
  `.dev.vars` created with real credentials — gitignored, never commit it.

### E — Supabase CLI (for migrations)

- [ ] **P.17** Verify the Supabase CLI is resolvable (already a dev dependency as `supabase` v2.23.4; `@supabase/supabase-js` updated to v2.107.0):
  ```bash
  npx supabase --version   # should print 2.x.x
  ```
- [ ] **P.18** Link the CLI to your production Supabase project:
  ```bash
  npx supabase login         # opens browser for auth
  npx supabase link          # prompts for project ref
  ```
  The project ref is the subdomain in your project URL: `https://<project-ref>.supabase.co`.
  - ⚠️ `supabase link` writes a `.supabase/` config directory. This directory is safe to commit (it contains no secrets).
- [ ] **P.19** Verify the link:
  ```bash
  npx supabase status
  ```
  Should show the linked project name and region. If it errors, re-run `supabase link` and ensure you're logged in.
- [ ] **P.20** Run any pending migrations against production:
  ```bash
  npx supabase db push
  ```
  - ⚠️ `db push` applies all migrations in `supabase/migrations/` that haven't been applied yet. Review the diff output carefully before confirming — this runs against your live production database.
  - ⚠️ **Edge case:** If the production database is brand new (empty), `db push` applies all migrations cleanly. If the database already has a schema from a previous manual setup, there may be conflicts — use `supabase db diff` first to inspect what would change.

### F — Local Dev Smoke Test

- [ ] **P.21** Start the local dev server (Cloudflare workerd runtime):
  ```bash
  npm run dev
  ```
  The server runs on `http://localhost:4321` using the same `workerd` runtime as production.
- [ ] **P.22** Verify Supabase connectivity locally:
  - Open `http://localhost:4321`
  - Attempt sign-up or sign-in — if auth works, Supabase is correctly wired.
  - ⚠️ If you see `Invalid API key` or `Failed to fetch`, double-check `.dev.vars` values — `SUPABASE_URL` must end with `.supabase.co` (no trailing slash), `SUPABASE_KEY` must be the `anon` key not the `service_role` key.

---

## Phase 0 — Pre-flight Verification

> Confirm local tooling and config is correct before touching Cloudflare.

- [x] **0.1** Rename worker in `wrangler.jsonc`: change `"name": "10x-astro-starter"` → `"name": "10xcards"`
  - ⚠️ Do this _before_ the first deploy. Once the Worker is registered on Cloudflare, renaming creates a new Worker and orphans the old one.
- [x] **0.2** Verify `wrangler.jsonc` has all required fields — final config:
  ```jsonc
  {
    "name": "10xcards",
    "main": "@astrojs/cloudflare/entrypoints/server",
    "compatibility_date": "2026-05-08",
    "compatibility_flags": ["nodejs_compat"],
    "kv_namespaces": [{ "binding": "SESSION", "id": "1e914c9b0b3346369e25022b58c789de" }],
    "assets": { "binding": "ASSETS", "directory": "./dist", "not_found_handling": "404-page" },
    "observability": { "enabled": true }
  }
  ```
  > **Note:** `@astrojs/cloudflare` v13+ auto-enables KV-backed Astro sessions by default. The `SESSION` KV namespace was created via `npx wrangler kv namespace create SESSION` and wired in above. The app uses Supabase for auth (not `Astro.session`), so the namespace is bound but idle. `imageService: "passthrough"` was added to `astro.config.mjs` to disable Cloudflare Images (not needed for MVP).
- [x] **0.3** Verify local build succeeds end-to-end:
  - Build passes with `npm run build` — `dist/` produced, no errors.
  - Remaining output is a sitemap warning (no `site` URL configured yet — expected at this stage) and an informational "Enabling sessions" message (expected given the note above).
  - `.dev.vars` populated with real Supabase credentials.
- [x] **0.4** Check for any Cloudflare Pages Git integration that may exist from a previous connection:
  - Cloudflare Dashboard → Workers & Pages → check for any Pages project pointing at this repo.
  - If found: disconnect the Git integration immediately to prevent duplicate "failed" deploy notifications alongside Workers Builds.
  - ⚠️ **Edge case:** A disconnected Pages project still keeps its `*.pages.dev` URL live until the project is deleted. Decide whether to delete it or leave it dormant.

---

## Phase 1 — Cloudflare Account & Authentication

> `wrangler login` and `wrangler whoami` are covered in **Prerequisites P.11–P.12**. Start here if those steps are already done.

- [x] **1.1** Confirm wrangler is authenticated (quick check):
  ```bash
  npx wrangler whoami
  ```
  If it errors, go back to Prerequisite P.4.
- [x] **1.2** Create a scoped API token for Workers Builds (do **not** use your global API key):
  - Cloudflare Dashboard → My Profile → API Tokens → Create Token
  - Use the **"Edit Cloudflare Workers"** template, or create a custom token with:
    - `Account > Workers Scripts > Edit`
    - `Zone > Workers Routes > Edit` (only if using custom domain routing)
  - Scope to the specific account (not all accounts).
  - ⚠️ **Edge case:** The token template includes zone-level permissions scoped to "All zones" by default — restrict it to the specific zone hosting your custom domain.
  - Copy the token value — you won't see it again. Workers Builds uses this internally; it does not need to be stored in GitHub.
- ~~**1.3**~~ ~~Store `SUPABASE_URL` and `SUPABASE_KEY` as GitHub Actions secrets~~ — **removed**: deploy is handled by Cloudflare Workers Builds, not GitHub Actions. The existing `ci.yml` secrets are already in place for the lint+build quality gate.

---

## Phase 2 — Push Production Secrets to Workers

> Workers Secrets are separate from `.dev.vars` (local) and GitHub Actions secrets (CI build).
> They must be pushed explicitly to the Cloudflare Workers Secrets store.

- [x] **2.1** Push `SUPABASE_URL` interactively:
  ```bash
  npx wrangler secret put SUPABASE_URL
  # Paste value when prompted
  ```
- [x] **2.2** Push `SUPABASE_KEY` interactively:
  ```bash
  npx wrangler secret put SUPABASE_KEY
  ```
- [x] **2.3** Verify secrets are registered (does not reveal values):
  ```bash
  npx wrangler secret list
  ```
  Expected output: `SUPABASE_URL` and `SUPABASE_KEY` both listed.
- [x] **2.4** Document the secret rotation runbook in this file (see [Secret Rotation Runbook](#secret-rotation-runbook) below).
  - ⚠️ **Edge case:** `wrangler secret put` is interactive — it cannot be piped a value directly in a standard shell. For non-interactive rotation via CI, use the `secrets` parameter in `cloudflare/wrangler-action` (see Phase 4).

---

## Phase 3 — First Manual Deploy

> Validate the full build→deploy pipeline before wiring CI.

- [x] **3.1** Build and deploy to production:
  ```bash
  npm run build && npx wrangler deploy
  ```
  First deploy registers the Worker and prints a `https://10xcards.bialczyk-klaudia91.workers.dev` URL.
- [x] **3.2** Smoke-test the workers.dev URL:
  - Load the homepage
  - Attempt sign-in (Supabase auth)
  - Verify a protected route redirects correctly
- [x] **3.3** Check live logs during smoke test:
  ```bash
  npx wrangler tail 10xcards --format=pretty
  ```
  Confirm requests and responses appear with no runtime errors.
  - ⚠️ **Edge case:** If `wrangler tail` returns `"Worker not found"`, the worker name in `wrangler.jsonc` doesn't match the deployed name. Verify with `npx wrangler deployments list`.
- [x] **3.4** Record the first deployment ID for future rollback reference:
  ```bash
  npx wrangler deployments list
  ```
  Note the ID in this document under [Deployment Log](#deployment-log).

---

## Phase 4 — Cloudflare Workers Builds (Auto-deploy on Push to Master)

> Cloudflare Workers Builds is Cloudflare's native CI/CD. It watches your GitHub repo and deploys on every push to `main` — no GitHub Actions deploy job, no Cloudflare API token in GitHub.
>
> The existing `ci.yml` stays as a **quality gate** (lint + build check on PRs). Workers Builds handles the actual deploy.

### 4A — Connect GitHub Repo to Workers Builds

- [x] **4.1** Open the Cloudflare dashboard → **Workers & Pages** → **Create application** → **Workers Builds** (or open the existing `10xcards` Worker → **Settings** → **Builds**).
- [x] **4.2** Click **Connect to Git** → authorize the Cloudflare GitHub App on your repository (grant access to `10xCards` only, not all repos).
  - ⚠️ **Edge case:** If the Cloudflare GitHub App was previously authorized for a Pages project, it may already have access. Re-authorizing for a Worker project is still required — they use the same App but separate integrations.
- [x] **4.3** Configure the build settings:

  | Field | Value |
  |---|---|
  | Branch to deploy | `main` |
  | Build command | `npm run build` |
  | Deploy command | `npx wrangler deploy` |
  | Root directory | *(leave blank — project root)* |
  | Node.js version | `22` |

  - ⚠️ **Edge case:** Workers Builds runs the build on Cloudflare's own infrastructure. The Node.js version must be set explicitly to 22 — the default may be an older version that is incompatible with Astro 6.

- [x] **4.4** Add environment variables in the Workers Builds UI (these are injected at build time — equivalent to what `SUPABASE_URL`/`SUPABASE_KEY` do in `ci.yml`):
  - Add `SUPABASE_URL` → mark as **Encrypted**
  - Add `SUPABASE_KEY` → mark as **Encrypted**
  - ⚠️ These build-time env vars are separate from **Workers Secrets** (runtime). Both must be set: build-time vars here, runtime secrets via `wrangler secret put` (already done in Phase 2).

- [x] **4.5** Click **Save and Deploy**. Workers Builds triggers an immediate first build from `main`.
  - Monitor the build log in the dashboard. A successful first build confirms the integration works.
  - ⚠️ **Edge case:** If the build log shows `"Cannot find module @astrojs/cloudflare"` or similar, the `package.json` `dependencies` vs `devDependencies` split may cause Workers Builds to skip installing dev deps. Check that all build-required packages are in `dependencies` (or that the build command runs `npm ci` which installs all deps).

### 4B — Preview Deployments on PRs

- [x] **4.6** Workers Builds automatically creates a preview deployment for every pull request push to `main`. The preview URL is `https://<hash>.bialczyk-klaudia91.workers.dev`.
  - ⚠️ Preview URLs are publicly accessible by default — this is addressed in Phase 6 (Cloudflare Access).
  - ⚠️ **Edge case (fork PRs):** Workers Builds does **not** trigger for PRs opened from forks (same restriction as GitHub Actions secrets). Only PRs from branches within the same repo get preview deployments.

- [x] **4.7** (Optional) Configure branch-specific deploy behaviour — Workers Builds → **Settings** → **Branches and deployments**:
  - Production branch: `main` → deploys to `10xcards` Worker
  - Preview branches: all other branches → deploys to `10xcards-preview` (or a per-branch subdomain)

### 4C — Keep `ci.yml` as a Quality Gate Only

The existing GitHub Actions workflow stays unchanged — it provides lint + build checks on PRs (the feedback loop GitHub natively surfaces in the PR UI). No deploy step is added to it.

- [x] **4.8** Confirm the existing `ci.yml` still passes after the Workers Builds integration is active (no conflicts — they are independent pipelines).
- [x] **4.9** (Optional) Add a `wrangler deploy --dry-run` step to `ci.yml` to catch Workers runtime compatibility issues at PR time:
  ```yaml
  - name: Workers compatibility dry-run
    run: npx wrangler deploy --dry-run
  ```
  - ⚠️ `--dry-run` does **not** require a Cloudflare API token when `wrangler.jsonc` is present and complete — it validates the config and bundle locally without contacting Cloudflare. This makes it safe to run on fork PRs without exposing any secrets.

---

## Phase 5 — Custom Domain

- [ ] **5.1** Ensure the domain's DNS is managed by Cloudflare (or add the domain to Cloudflare):
  - Cloudflare Dashboard → Add a Site → follow DNS migration wizard if needed.
  - ⚠️ If using an external DNS provider (not Cloudflare), you can still add a Custom Domain to a Worker — Cloudflare will use a CNAME/A record approach, but you lose some edge routing benefits.
- [ ] **5.2** Assign custom domain to the Worker:
  - Cloudflare Dashboard → Workers & Pages → `10xcards` → Settings → Domains & Routes → Add Custom Domain
  - Enter your domain (e.g., `app.10xcards.com`)
  - Cloudflare automatically provisions a TLS certificate (Let's Encrypt via Cloudflare).
  - ⚠️ **Edge case:** If the domain already has a CNAME/A record for the apex or subdomain, the dashboard assignment may conflict. Check DNS records first and delete any conflicting entries.
- [ ] **5.3** Verify HTTPS works on the custom domain within 5 minutes of assignment.
- [ ] **5.4** (Optional) Redirect `www` → apex or vice versa using a Cloudflare Redirect Rule (Dashboard → Rules → Redirect Rules).

---

## Phase 6 — Preview URL Security (Cloudflare Access)

> By default, any `*.workers.dev` preview URL is publicly accessible. This is a data exposure risk if the Worker serves staging data or admin routes.

- [ ] **6.1** Enable Cloudflare Access for preview deployments:
  - Cloudflare Dashboard → Zero Trust → Access → Applications → Add an Application → Self-Hosted
  - Domain: `*.bialczyk-klaudia91.workers.dev` (wildcard covers all preview subdomain variants for this account)
  - Policy: Allow → Email ends with `@your-org.com` (or specific email list)
  - ⚠️ **Edge case:** Cloudflare Access requires a Zero Trust account. The free tier (up to 50 users) covers small teams. Adding Access to `*.workers.dev` may block the GitHub Actions deployment health check — add a service token for CI.
- [ ] **6.2** Create a Cloudflare Access Service Token for CI health checks:
  - Zero Trust → Access → Service Auth → Service Tokens → Create Service Token
  - Store token credentials as GitHub Actions secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`
  - Use in any CI health-check `curl` commands via headers: `CF-Access-Client-Id: ...`, `CF-Access-Client-Secret: ...`
- [ ] **6.3** Verify access policy blocks unauthenticated access to the workers.dev subdomain.

---

## Phase 7 — Log Retention (Cloudflare Logpush)

> `wrangler tail` is live-only. If a request fails while no one is tailing, the log is gone.

- [ ] **7.1** Choose a log destination. Options in order of cost:
  - **Cloudflare R2** (cheapest): Store raw logs in your own bucket; query with SQL via Workers Analytics Engine or manually. ~$0.015/GB stored.
  - **Axiom** (free tier: 0.5 GB/day ingest, 30-day retention): Best DX for log queries; first-party Cloudflare integration. Good for MVP.
  - **Better Stack** (formerly Logtail): Similar to Axiom; free tier 1 GB/day.
  - Recommendation for MVP: **Axiom** (zero infrastructure to manage, generous free tier, official Cloudflare integration).
- [ ] **7.2** Set up Logpush to Axiom (or chosen destination):
  - Cloudflare Dashboard → Analytics & Logs → Logpush → Create Logpush Job
  - Source: Workers Trace Events
  - Destination: Axiom (enter API key and dataset name)
  - Fields: at minimum `Event.RayID`, `Event.Request.URL`, `Event.Response.Status`, `Event.Exceptions`, `Event.Logs`
  - ⚠️ **Edge case:** Logpush requires a paid Cloudflare plan for some sources. Workers Trace Events Logpush is available on the Workers Paid plan ($5/month) — this is already needed (see Phase 8). Confirm this before setting up.
- [ ] **7.3** Verify logs appear in Axiom within 5 minutes of a test request.
- [ ] **7.4** Set a log retention policy in Axiom (30 days recommended for MVP).

---

## Phase 8 — Upgrade to Workers Standard (Paid Tier)

> The free tier limits CPU time to 10ms per invocation. AI-heavy routes (OpenRouter calls, Markdown parsing) likely exceed this.

- [ ] **8.1** Benchmark CPU time on free tier _before_ going live with real users:
  ```bash
  npx wrangler tail 10xcards --format=json | jq '.cpuTime'
  ```
  If any route consistently approaches or exceeds 10ms CPU time, upgrade immediately.
- [ ] **8.2** Upgrade to Workers Standard:
  - Cloudflare Dashboard → Workers & Pages → Plans → Upgrade to Workers Standard ($5/month)
  - Workers Standard: 30s CPU time per invocation, 10M requests/month included.
  - ⚠️ The upgrade applies at the account level, not per-Worker. All Workers in the account benefit.
- [ ] **8.3** After upgrading, re-benchmark AI routes and confirm they complete within the 30s CPU limit.
  - ⚠️ **Edge case (pre-mortem scenario):** If a future refactor moves Markdown parsing to SSR, it can silently push CPU time over the limit. Add CPU time monitoring in Axiom with an alert threshold at 20s.

---

## Phase 9 — Rollback & Recovery Procedures

> Document these _before_ they're needed in an incident.

- [x] **9.1** Document the rollback command:
  ```bash
  # Roll back to the previous deployment
  npx wrangler rollback

  # Roll back to a specific deployment
  npx wrangler rollback --deployment-id <id>
  ```
  ⚠️ **Critical:** Rollback reverts the Worker script only. Any Supabase migrations applied in the same release are **not** reversed. Code rolled back to an older version that expects the old schema will fail if the migration was a breaking change.
- [ ] **9.2** Establish the migration backward-compatibility rule:
  - Every SQL migration file in `supabase/migrations/` must have a paired `rollback.sql` or be written as backward-compatible (additive-only: new columns nullable, new tables, no column renames/drops).
  - Add this to `AGENTS.md` and `CLAUDE.md` as a hard rule.
- [x] **9.3** Add a deployment log entry procedure (see [Deployment Log](#deployment-log) below) — log the deployment ID and migration version after every production deploy.
- [ ] **9.4** Test rollback on production using a low-risk deploy:
  ```bash
  # After any deploy, verify you can roll back
  npx wrangler deployments list
  npx wrangler rollback --deployment-id <previous-id>
  # Confirm the site still works, then re-deploy the latest
  npx wrangler deploy
  ```

---

## Phase 10 — Post-Launch Monitoring

- [ ] **10.1** Verify Cloudflare dashboard metrics (Workers & Pages → `10xcards` → Metrics):
  - Request count, error rate, CPU time p50/p95/p99
  - Set up an email alert for error rate > 5% over 5 minutes (Cloudflare → Notifications → Workers)
- [ ] **10.2** Confirm Logpush is delivering (check Axiom dashboard for recent entries).
- [ ] **10.3** Validate Cloudflare Access is protecting the `*.workers.dev` preview zone.
- [ ] **10.4** Run `npx wrangler tail 10xcards --format=json` during a traffic spike to confirm CPU times are well within limits.
- [ ] **10.5** Review the Risk Register from `infrastructure.md` and confirm each mitigation is in place:
  - [ ] CPU time benchmarked and Workers Standard upgraded if needed
  - [ ] Logpush active (log retention in place)
  - [ ] Cloudflare Access on `*.workers.dev`
  - [ ] Rollback SQL scripts alongside each migration
  - [ ] `--dry-run` in CI catching compatibility issues
  - [ ] Old Cloudflare Pages integration disconnected (if it existed)
  - [ ] Secret rotation runbook documented

---

## Secret Rotation Runbook

When rotating `SUPABASE_URL` or `SUPABASE_KEY`:

1. Rotate the **Workers Secret** (runtime) via CLI:
   ```bash
   npx wrangler secret put SUPABASE_KEY
   # paste new value when prompted
   npx wrangler secret list  # verify it's listed
   ```
2. Rotate the **Workers Builds build-time env var** (needed so the next Workers Builds deploy builds with the new value):
   - Cloudflare Dashboard → Workers & Pages → `10xcards` → Settings → Builds → Environment variables → edit the relevant var.
3. Verify the live Worker is still healthy after rotation:
   ```bash
   npx wrangler tail 10xcards --format=pretty
   # Hit sign-in and a protected route; confirm no auth errors in the log
   ```
4. Log the rotation date in the [Deployment Log](#deployment-log).

---

## Deployment Log

| Date | Version / Commit | Deployment ID | Migration Applied | Notes |
|---|---|---|---|---|
| 2026-06-03 | initial manual deploy | — | none | https://10xcards.bialczyk-klaudia91.workers.dev ✅ |
| 2026-06-03 | Workers Builds first auto-deploy | `ce8719af-cdd9-47ee-ae2b-62f220e6ba3e` | none | https://10xcards.bialczyk-klaudia91.workers.dev — pipeline confirmed ✅ |

---

## Edge Cases & Extra Support Steps (Summary)

| Edge Case | Where It Bites | Mitigation |
|---|---|---|
| Old Cloudflare Pages Git integration fires on push | Phase 0 | Disconnect Pages GitHub integration before first Workers deploy |
| Worker name already taken on Cloudflare | Phase 0 | Choose a unique name; `10xcards` may be taken — try `10xcards-app` |
| `wrangler secret put` is interactive (no pipe) | Phase 2 | Use `wrangler-action` `secrets:` param in CI instead of interactive CLI |
| Fork PRs don't trigger Workers Builds preview deploys | Phase 4 | Expected behaviour — preview deploys only fire for branches within the same repo |
| `--dry-run` in GHA requires no API token (local validation only) | Phase 4 | Safe to run on all PRs including forks; validates bundle without contacting Cloudflare |
| Cloudflare Access blocks CI health checks | Phase 6 | Create a Service Token and pass it via `CF-Access-*` headers |
| AI route CPU time > 10ms on free tier | Phase 8 | Benchmark _before_ launch; upgrade to Workers Standard ($5/mo) |
| Rollback doesn't revert DB migration | Phase 9 | Write additive-only migrations + paired rollback SQL scripts |
| New npm dependency uses `child_process` / native addon | Ongoing | `--dry-run` in CI; test with `workers-types` before merging |
| Preview URL leaks sensitive data | Ongoing | Cloudflare Access wildcard policy on `*.workers.dev` |
| Log gaps during incidents | Ongoing | Logpush to Axiom/R2 before launch |
