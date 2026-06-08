# Gate Product Routes — Plan Brief

> Full plan: `context/changes/gate-product-routes/plan.md`

## What & Why

The current auth middleware protects only `/dashboard`. Any product route added in future slices (S-01: generation, S-02: deck save, S-03: deck edit, S-04: study session) would be silently unprotected unless manually added to `PROTECTED_ROUTES` — a data-leak risk flagged in roadmap F-01. This change flips the default: everything is protected unless explicitly listed as public.

## Starting Point

`src/middleware.ts` has `PROTECTED_ROUTES = ["/dashboard"]` (line 4) matched with `startsWith`. There are 8 pages total — 3 auth pages, 1 dashboard, 1 home, 3 auth API routes — and no product routes yet. `SignInForm.tsx` POSTs to `/api/auth/signin`, which always redirects to `/` on success regardless of where the user came from.

## Desired End State

`src/middleware.ts` uses `PUBLIC_ROUTES = ["/auth", "/api/auth", "/sitemap"]` plus an exact match for `"/"`. Every future product route is gated automatically. Unauthenticated API requests (`/api/*` not under `/api/auth/`) get a `401 JSON` response. Unauthenticated page visits redirect to `/auth/signin?returnTo=<original-path>`. After signing in, users land at their intended destination, with open-redirect sanitization ensuring only same-origin paths are honored.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Routing pattern | Negative allow-list (PUBLIC_ROUTES) | Positive list requires a middleware edit per new route; negative list gates new routes automatically |
| Product URL structure | Individual top-level paths (`/generate`, `/deck`, `/study`) | Clean URLs per feature; drives the choice of negative pattern since there's no shared prefix |
| Unauthenticated API response | HTTP 401 JSON | Fetch-based callers can't follow a 302 redirect; JSON error is the correct contract |
| Post-login redirect | `?returnTo=` preserved through signin flow | Expected UX; absence causes user confusion when arriving via a protected-route redirect |

## Scope

**In scope:**
- Rewrite `src/middleware.ts` — `PROTECTED_ROUTES` → `PUBLIC_ROUTES`, dual response (401 / redirect), `returnTo` param
- `src/pages/auth/signin.astro` — extract and forward `returnTo`
- `src/components/auth/SignInForm.tsx` — add `returnTo` hidden field
- `src/pages/api/auth/signin.ts` — read, sanitize, and honor `returnTo`

**Out of scope:**
- New product pages or API endpoints (S-01 through S-04)
- Auto-redirect for already-logged-in users visiting `/auth/signin`
- Role-based access control
- Automated tests (no test runner configured)

## Architecture / Approach

Middleware is the single auth chokepoint. The negative-list check is: `pathname === "/" || PUBLIC_ROUTES.some(r => pathname.startsWith(r))`. If not public and user is null: API requests get a `new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })`, page requests get `context.redirect("/auth/signin?returnTo=...")`. The `returnTo` value flows: middleware URL param → `signin.astro` prop → `SignInForm` hidden input → `signin.ts` form data read → sanitized redirect.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Rewrite middleware | Negative allow-list active; 401 for API; `returnTo` in redirect | Home page (`/`) must be exact-matched, not prefix-matched — getting this wrong makes every route public |
| 2. Thread returnTo | Users land at intended destination after login; open-redirect blocked | Sanitization must reject `//evil.com` and `https://…`; missing check is a security bug |

**Prerequisites:** Supabase auth working locally (`.dev.vars` with `SUPABASE_URL` + `SUPABASE_KEY`)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- `@astrojs/sitemap` routes (`/sitemap-index.xml`, `/sitemap-0.xml`) must be public — covered by `/sitemap` prefix in `PUBLIC_ROUTES`; if the integration changes its URL pattern, the prefix must be updated
- The `returnTo` value includes query string (`pathname + context.url.search`) — verify URL encoding round-trips correctly for paths with existing query params

## Success Criteria (Summary)

- A logged-out user visiting any future product route is automatically redirected to signin — no middleware edit required
- A logged-out user calling any future product API endpoint receives `HTTP 401 JSON`, not a redirect
- A user who signs in after being redirected lands on their original page, not `/`
