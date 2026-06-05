# Repository Guidelines

10xCards is an Astro 6 SSR app with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui, deployed to Cloudflare Workers. See @CLAUDE.md for the full conventions reference.

## Hard Rules

- Never spawn Task subagents for web research or URL fetching — subagents block silently on outbound network. Use `WebSearch`/`WebFetch` directly in the parent agent; max 3 parallel calls per message.
- API routes must export `const prerender = false`; omitting it silently breaks SSR routing.
- Never use `"use client"` or other Next.js directives in React components.
- Never concatenate Tailwind class strings manually; always use `cn()` from `@/lib/utils`.
- New Supabase tables require RLS with granular per-operation, per-role policies — no table-wide grants.
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets; never import them in client-side code.

## Build & Development Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (requires `SUPABASE_URL` + `SUPABASE_KEY`)
- `npm run lint` — ESLint with strict TypeScript rules; runs in CI
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier with Astro + Tailwind plugins

CI (`@.github/workflows/ci.yml`) runs `lint` then `build` on every push and PR to `master`. Set `SUPABASE_URL` and `SUPABASE_KEY` as GitHub repository secrets for CI builds.

## Project Structure

`@/*` maps to `./src/*` (see @tsconfig.json). Key locations:

- `src/components/` — Astro + React components; shadcn/ui in `ui/`; React hooks in `hooks/`
- `src/lib/` — helpers; extracted business logic in `src/lib/services/`
- `src/pages/api/` — API endpoints
- `src/types.ts` — shared entities and DTOs
- `supabase/migrations/` — SQL migrations named `YYYYMMDDHHmmss_short_description.sql`

## Coding Conventions

Use Astro components for static content and layout; use React only for interactive islands. Place new React hooks in `src/components/hooks/`. Place shared types and DTOs in `src/types.ts`.

API route files export uppercase method names (`GET`, `POST`, etc.) and validate all input with zod. Install shadcn/ui components with `npx shadcn@latest add [name]`; they land in `src/components/ui/`.

Pre-commit hooks (husky + lint-staged) run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` automatically.

## Security & Environment

Copy `.env.example` to `.env` for Node dev, or to `.dev.vars` for Cloudflare local dev (`wrangler`). Both files are gitignored. Never commit either file. Deploy secrets via `npx wrangler secret put` or the Cloudflare dashboard.
