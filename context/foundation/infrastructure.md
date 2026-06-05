---
project: 10xCards
researched_at: 2026-06-03
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19 islands
  runtime: Cloudflare Workers (workerd via @astrojs/cloudflare v13+)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The stack is already configured for Cloudflare Workers — `@astrojs/cloudflare` v13+ is installed, `astro dev` runs on the `workerd` runtime for production parity, and `wrangler 4.x` is the deploy CLI. Zero adapter migration cost, and the user is already familiar with the platform. The free tier (100k requests/day) comfortably covers MVP-scale traffic with Supabase and OpenRouter as external providers — co-location is not needed. The tie with Vercel on raw scoring was broken by existing familiarity and zero migration cost.

---

## Platform Comparison

| Platform | CLI-first | Managed / Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Score |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Partial | **4.5** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | **4.5** |
| **Netlify** | Pass | Pass | Pass | Partial | Fail | **3.5** |
| **Railway** | Pass | Pass | Partial | Pass | Fail | **3.5** |
| **Fly.io** | Pass | Fail | Pass | Pass | Fail | **3** |
| **Render** | Partial | Pass | Partial | Pass | Fail | **2.5** |

**Scoring notes per platform:**

- **Cloudflare Workers**: `wrangler 4.x` covers deploy (`wrangler deploy`), live log tailing (`wrangler tail`), and rollback (`wrangler rollback`). Docs are on GitHub in markdown. Cloudflare has an official MCP server project (Workers platform MCP), hence Partial rather than Fail on MCP. The project already uses this adapter — no migration work required.
- **Vercel**: Tied on scoring but Hobby plan is explicitly **non-commercial use only**; 10xCards is a real product MVP, so Pro ($20/user/month) is required from day one. Still the strongest runner-up — preview deploys, `vercel` CLI, and DX are best-in-class. Would require swapping to `@astrojs/vercel` adapter.
- **Netlify**: New credit-based pricing (effective September 4, 2025) is opaque — production deploys cost 15 credits each against a 300-credit hard cap on the free tier (~20 production deploys before the account is suspended for the month). Partial on "Stable deploy API" because billing behavior is a deployment-blocking surprise.
- **Railway**: Always-on Node.js PaaS with no cold starts, clean `railway` CLI, and usage-based pricing (~$5-10/month for a small SSR app). Good runner-up to Vercel. Would require adapter swap to `@astrojs/node`. Docs are decent but less comprehensive than Cloudflare/Vercel.
- **Fly.io**: Requires Docker knowledge and real VM management — higher operational overhead than a serverless platform. No free tier for new accounts (removed). Steepest learning curve of the six; Fail on "Managed/Serverless."
- **Render**: Limited CLI (dashboard-driven for most operations). Free tier spins down after 15 minutes of inactivity with 30-60 second cold starts — not acceptable for a user-facing product. Paid starts at $7/month.

---

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the configured deployment target — `@astrojs/cloudflare` v13+ is installed and `astro dev` runs on the Workers runtime via the Cloudflare Vite plugin. Deploy is a single `npx wrangler deploy`. Free tier (100k requests/day) covers MVP scale, and the paid tier is $5/month for 10M requests/month. Excellent CLI (`wrangler`), markdown docs on GitHub, and an official Cloudflare MCP server in active development. The only adapter available for Astro 6 Workers deployment — Pages support was removed in v13.

#### 2. Vercel

Best-in-class developer experience with preview deploys per PR, instant rollbacks, and the `vercel` CLI. Equal score to Cloudflare but behind on cost: the free Hobby plan prohibits commercial use, making Pro ($20/user/month) mandatory for 10xCards. Would require swapping to `@astrojs/vercel` adapter and revalidating the dev server setup (Vercel's dev server does not run on Workers runtime). Strong choice if budget allows.

#### 3. Railway

Always-on Node.js PaaS with no cold starts, usage-based billing (~$5-10/month for this scale), and a clean `railway` CLI. Managed platform with less operational overhead than Fly.io. Would require adapter swap to `@astrojs/node` (standalone mode). Weaker documentation and no MCP integration, but solid for teams already familiar with PaaS-style deployments.

---

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **CPU time is the real limit, not request count.** The free tier grants 10ms of *CPU time* per invocation (not wall-clock time). I/O waits (Supabase queries, OpenRouter calls) don't count against CPU, but SSR rendering, JSON processing, and middleware do. Pages with heavy server-side computation can hit 10ms easily. Workers Standard ($5/month) raises this to 30s CPU per invocation — the free tier may be too tight for AI-heavy routes.
2. **Cloudflare Pages is dead for Astro 6.** The `@astrojs/cloudflare` v13+ adapter removed Pages support entirely — all SSR deployments must use Workers. Any existing Pages setup (dashboard Git integration, CI pipeline pointing at Pages) must be manually replaced with Workers Builds or a `wrangler`-based CI step. Tutorials older than early 2026 that reference Pages are wrong.
3. **Workers runtime is not Node.js.** Some npm packages assume full Node.js APIs (`child_process`, writable `fs`, native addons). These fail silently at runtime rather than at build time. The `nodejs_compat` flag covers most cases, but any new dependency needs validating against the Workers environment. Supabase JS and OpenRouter SDK are fine; spaced-repetition libraries must be verified.
4. **Build-per-environment is a CI friction point.** As of Astro 6, you must build separately per Cloudflare environment: `CLOUDFLARE_ENV=staging astro build && wrangler deploy`. No "build once, promote" workflow. Staging and production require separate build steps in CI.
5. **Secrets are split across two systems.** Production secrets live in Workers Secrets (`wrangler secret put`); local dev secrets live in `.dev.vars`. These don't sync. A new CI environment requires re-running `wrangler secret put` for every secret, and rotation is a manual CLI step.

### Pre-Mortem — How This Could Fail

Six months after launch, 10xCards has real users but the team is fighting a production crisis: AI card generation is timing out intermittently. The root cause takes two weeks to find. The OpenRouter call itself takes 3-8 seconds of wall-clock time, which is fine — Workers has no wall-clock limit on Standard. But a refactor moved Markdown parsing server-side, pushing CPU time over the Workers Standard threshold. Because the failure manifests as a generic `1101 Worker threw exception` error — with no useful stack trace in `wrangler tail` output and no log retention (logs are live-only by default) — debugging required adding extensive manual instrumentation across multiple deploys.

Separately, a developer adds a spaced-repetition scheduling library that internally calls `child_process.exec` to shell out to a binary. It works locally under Node.js. On Workers it fails silently at runtime — no build-time error, no clear exception. Two days of debugging traces it to an indirect dependency. The fix: replace the library with a pure-JS implementation.

Finally, the staging environment was configured incorrectly because CI was built with the old "build once, deploy to both" pattern from Astro 5. Staging was unknowingly running with production environment variables for three weeks before a user noticed an environment indicator in the UI. By then, test data had been written to the production Supabase project.

### Unknown Unknowns

- **`wrangler tail` is live-only, not historical.** There is no log storage by default. If a request fails while you're not actively tailing, the log is gone. Retaining logs requires Cloudflare Logpush (paid add-on) or a third-party drain (Axiom, Better Stack, Datadog).
- **Preview deploy URLs are publicly accessible by default.** Workers Builds creates preview deployments at `*.workers.dev` subdomains with no access control. If your staging data or admin routes are in a preview, anyone with the URL can reach them. Cloudflare Access can protect them but requires explicit setup not included in the default Workers Builds workflow.
- **`wrangler rollback` rolls back code, not database state.** If a deploy includes a Supabase migration and you rollback the Worker, the DB schema stays at the migrated version. Rolling back code does not undo schema changes.
- **The project may have a Cloudflare Pages Git integration that silently conflicts.** If the repository was previously connected to Cloudflare Pages via the dashboard's GitHub integration, that integration still fires on push and may produce confusing "failed" build notifications alongside Workers Builds. The Pages integration needs to be explicitly disconnected.

---

## Operational Story

- **Preview deploys**: Workers Builds creates a preview deployment at a `*.workers.dev` subdomain on every PR push. Preview URLs are publicly accessible by default — use Cloudflare Access to restrict them. Fork PRs do not trigger Workers Builds (same restriction as GitHub Actions for forks).
- **Secrets**: Production secrets live in Workers Secrets, managed via `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY`. Local dev secrets live in `.dev.vars` (gitignored). CI secrets go in GitHub Actions Secrets and are passed to `wrangler deploy` via environment. There is no automatic sync between these three stores.
- **Rollback**: Run `npx wrangler rollback` (or `wrangler rollback --deployment-id <id>`) to revert to a prior deployment in under 30 seconds. This rolls back the Worker script only — any Supabase migrations applied in the same release are not reversed automatically.
- **Approval**: Human required for: running `wrangler secret put` on production (rotates live credentials), deleting a Worker or KV namespace, and any Supabase schema migration. An agent may deploy code unattended via `wrangler deploy` and tail logs via `wrangler tail`.
- **Logs**: Live log tailing — `npx wrangler tail <worker-name>` streams real-time requests and console output. For historical logs, set up Cloudflare Logpush to a destination (R2, Datadog, Axiom) or use `wrangler tail --format=json` piped to a file during debugging sessions.

---

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| AI-heavy SSR routes hit the 10ms free-tier CPU limit | Devil's advocate | H | M | Upgrade to Workers Standard ($5/mo) before launch or benchmark AI routes on free tier with `wrangler tail --format=json` to measure CPU time before going live |
| Production incident goes undebugged due to missing log retention | Unknown unknowns | M | H | Add Cloudflare Logpush to R2 or Axiom before launch; costs ~$0.20/GB stored |
| Preview deploy leaks staging data via public `*.workers.dev` URL | Unknown unknowns | M | M | Enable Cloudflare Access on the preview zone immediately after Workers Builds setup; use a service token for CI health checks |
| `wrangler rollback` used during incident but DB migration not reversed | Unknown unknowns | L | H | Document that rollback = code only; all migrations must be backward-compatible; maintain a rollback SQL script alongside each migration file |
| Indirect npm dependency uses `child_process` or native addon — fails silently on Workers | Devil's advocate | M | M | Add `wrangler deploy --dry-run` to CI and review the Workers compatibility report; test new dependencies against `workers-types` before merging |
| Old Cloudflare Pages Git integration still fires on push, causing CI confusion | Unknown unknowns | H | L | Immediately disconnect the Pages Git integration from the Cloudflare dashboard after migrating to Workers Builds |
| Staging accidentally uses production Supabase due to build-per-environment misconfiguration | Pre-mortem | M | H | Add an explicit `CLOUDFLARE_ENV` check in `astro.config.mjs` that throws if `SUPABASE_URL` contains "prod" when building for staging |
| Secrets not rotated properly — manual `wrangler secret put` step forgotten in runbook | Devil's advocate | M | M | Add `wrangler secret list <worker-name>` to the rotation runbook as a verification step; automate rotation via GitHub Actions secret update + wrangler deploy trigger |

---

## Getting Started

The project already has `@astrojs/cloudflare` v13+ and `wrangler` configured. These are the steps to go from repo to live on Workers:

1. **Verify wrangler config**: Check `wrangler.toml` (or `wrangler.jsonc`) exists at the project root with `name`, `compatibility_date`, and `compatibility_flags = ["nodejs_compat"]`. If it's missing, run `npx wrangler deploy` once — it will auto-generate one from the Astro adapter.
2. **Authenticate wrangler**: Run `npx wrangler login` to link your Cloudflare account. Confirm with `npx wrangler whoami`.
3. **Push production secrets**: Run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` — these set the live Workers Secrets (separate from `.dev.vars`).
4. **Deploy**: `npm run build && npx wrangler deploy`. The first deploy registers the Worker and returns a `*.workers.dev` URL. Assign a custom domain in the Cloudflare dashboard under Workers → your worker → Triggers.
5. **Set up Workers Builds (CI)**: In the Cloudflare dashboard, connect your GitHub repository under Workers & Pages → Create application → Workers Builds. Set build command to `npm run build`, output to `dist`, and add `SUPABASE_URL` / `SUPABASE_KEY` as encrypted environment variables. Every push to `main` will deploy automatically.

---

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (covered as a "Getting Started" step, not fully designed)
- Production-scale architecture (multi-region, HA, DR)
