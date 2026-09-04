---
bootstrapped_at: 2026-05-26T20:12:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10xcards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

10xCards is a greenfield web-app for a solo builder on a three-week after-hours timeline with medium user scale, email/password auth, AI-generated flashcards, and integrated spaced repetition added in application code. The recommended default for web in JavaScript/TypeScript is 10x-astro-starter: Astro with React islands, TypeScript, Supabase for auth and Postgres persistence, and Cloudflare Pages as the default deploy target. Spaced-repetition scheduling remains a deliberate MVP addition on top of the starter.

## Pre-scaffold verification

| Signal      | Value                                             | Severity | Notes                                                   |
| ----------- | ------------------------------------------------- | -------- | ------------------------------------------------------- |
| npm package | not run                                           | n/a      | cmd_template starts with `git clone`; npm step skipped  |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh | from card.docs_url; checked via GitHub API              |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: all (via rsync into /Users/klaudiabialczyk/Development/10xCards)
**Conflicts (.scaffold siblings)**: none (destination was empty)
**.gitignore handling**: moved silently (no prior .gitignore in destination)
**.bootstrap-scaffold cleanup**: deleted

Note: scaffold was run into a fresh sibling directory `../10xCards` (not the current 10x-cli repo), at user request.

## Post-scaffold audit

**Command**: `npm audit --json`
**Exit code**: informational only

| Severity | Count | Packages (sample)              |
| -------- | ----- | ------------------------------ |
| CRITICAL | 0     | —                              |
| HIGH     | 1     | devalue                        |
| MODERATE | 9     | @astrojs/check, @astrojs/language-server, @cloudflare/vite-plugin, and others |
| LOW      | 0     | —                              |

**Note**: 1 HIGH finding (`devalue`) and 9 MODERATE findings are present in the freshly scaffolded starter. These are in the starter's dependency tree; no action by bootstrapper — the user decides whether to patch. Run `npm audit` in `/Users/klaudiabialczyk/Development/10xCards` for the full report.

## Hints recorded but not acted on (v1)

The following hand-off hints are surfaced here for completeness; bootstrapper v1 does not generate files based on them:

- `deployment_target: cloudflare-pages` — wrangler.jsonc is present from the starter; Cloudflare-specific setup will need auth and project creation.
- `ci_provider: github-actions` — no `.github/workflows/` generated; CI scaffolding is deferred to a future M1L4 skill.
- `ci_default_flow: auto-deploy-on-merge` — deferred to M1L4.
- `has_auth: true` — Supabase auth is pre-wired in the starter; Supabase project and env vars still need configuration.
- `has_ai: true` — no AI plumbing generated; app-level integration is the developer's next step.
- `quality_override: false` — all four agent-friendly quality gates pass; no compensation entries needed.
- `self_check_answers: null` — standard path taken; no self-check was run.

## Next steps

Your project is scaffolded at `/Users/klaudiabialczyk/Development/10xCards`.

1. `cd /Users/klaudiabialczyk/Development/10xCards`
2. `git init` — bootstrapper does not manage git; the cloned `.git/` was removed so you start fresh.
3. Configure Supabase: create a project, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`.
4. Configure Cloudflare: authenticate with `wrangler login` and create a Pages project.
5. Run `npm run dev` to verify the local dev server starts.
6. A future skill (`AGENTS.md` / `CLAUDE.md` generation) will set up agent context for this project.
