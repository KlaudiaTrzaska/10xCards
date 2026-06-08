# Gate Product Routes — Implementation Plan

## Overview

Rewrite `src/middleware.ts` from a positive `PROTECTED_ROUTES` allow-list (each protected route must be manually added) to a negative `PUBLIC_ROUTES` allow-list (everything not listed as public is protected by default). Unauthenticated requests to API routes receive a `401 JSON` response; unauthenticated page requests are redirected to `/auth/signin?returnTo=<original-path>`. The `returnTo` destination is threaded through the signin page, form component, and POST handler so users land where they intended after logging in.

## Current State Analysis

Auth middleware exists in `src/middleware.ts` and runs on every request. It resolves the current user via Supabase SSR and currently protects only `/dashboard` using a positive `startsWith` match on `PROTECTED_ROUTES = ["/dashboard"]`. Any new product route (generation, deck management, study session) must be manually added to this array or it will be silently unprotected — the core risk called out in roadmap F-01.

There is no `src/types.ts` yet. `signout.ts` already falls under the `/api/auth/` prefix and will be automatically public under the new pattern.

### Key Discoveries

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; match at line 18 uses `startsWith`
- `src/middleware.ts:21` — current redirect target is `/auth/signin` with no `returnTo`
- `src/components/auth/SignInForm.tsx:43` — form POSTs to `/api/auth/signin`; no `returnTo` field
- `src/pages/api/auth/signin.ts:18` — always redirects to `/` on success
- `src/pages/auth/signin.astro:5` — already reads `error` from URL params; `returnTo` can be read the same way
- `astro.config.mjs:12` — `@astrojs/sitemap` integration active; its routes (`/sitemap-index.xml`, `/sitemap-*.xml`) must be public
- No `prerender` exports exist anywhere under `src/` — all routes are SSR by default

## Desired End State

After this change:

- `src/middleware.ts` uses `PUBLIC_ROUTES = ["/auth", "/api/auth", "/sitemap"]` plus an exact match for `"/"`. Every future product route added under any other prefix is automatically protected without any middleware edit.
- Unauthenticated calls to product API routes (`/api/*` not under `/api/auth/`) receive `HTTP 401` with `{ "error": "Unauthorized" }` JSON.
- Unauthenticated visits to product pages redirect to `/auth/signin?returnTo=<encoded-path>`.
- After signing in, the user is redirected to their original destination (sanitized, defaulting to `/`).
- All existing public routes (`/`, `/auth/*`, `/api/auth/*`) continue to work without auth.

### Key Discoveries

- Dual-matching rule for `"/"`: it cannot use `startsWith` like other public routes (every path starts with `/`); requires an exact-match check alongside prefix-match for the rest.
- API route detection: `pathname.startsWith("/api/")` is the right predicate; the combined check (not public AND not authenticated AND under `/api/`) triggers the 401 branch.
- `returnTo` sanitization must block open-redirect: only values that start with `"/"` and do NOT start with `"//"` are trusted; all others fall back to `"/"`.

## What We're NOT Doing

- Adding new product pages or API endpoints (those come in S-01 through S-04)
- Redirecting already-authenticated users away from auth pages (no auto-redirect to dashboard)
- Implementing role-based access control (all authenticated users are equal)
- Implementing remember-me, session refresh, or session extension logic
- Adding per-page auth checks — middleware is the single chokepoint
- Writing automated tests (no test runner is configured in the project)

## Implementation Approach

Two-phase, single-area change. Phase 1 is a rewrite of `src/middleware.ts` — the core security guarantee. Phase 2 threads the `returnTo` value through `signin.astro` → `SignInForm.tsx` → `signin.ts` — the UX improvement that makes the redirect useful. Phase 2 depends on Phase 1 only in that the `?returnTo=` query param originates there.

## Critical Implementation Details

**Dual-match rule for home (`/`):** `pathname === "/"` must be an exact check, not `startsWith`. Including `"/"` in `PUBLIC_ROUTES` with `startsWith` would make every path public. The implementation must special-case it.

**401 must return JSON, not a redirect:** When an unauthenticated request hits `/api/*`, return `new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } })`. Do not call `context.redirect()` — a redirect response breaks fetch-based callers that check for `401`.

**`returnTo` open-redirect sanitization:** The sanitized check in `signin.ts` is: `raw && raw.startsWith("/") && !raw.startsWith("//")`. A value like `//evil.com` passes the `startsWith("/")` check but fails `!raw.startsWith("//")`. Fall back to `"/"` for anything that doesn't pass.

---

## Phase 1: Rewrite Middleware to Negative Allow-List

### Overview

Replace `PROTECTED_ROUTES` with `PUBLIC_ROUTES`. Rewrite the guard logic so everything not explicitly public requires auth. Add distinct responses for API vs page requests. Add `?returnTo=` to the signin redirect.

### Changes Required

#### 1. Middleware core logic

**File**: `src/middleware.ts`

**Intent**: Replace the positive-list approach with a negative allow-list so that new product routes are protected automatically, without any middleware edit. Add a 401 JSON response for API routes and a `returnTo` param for page redirects.

**Contract**:

```typescript
const PUBLIC_ROUTES = ["/auth", "/api/auth", "/sitemap"];

// inside onRequest, after user resolution:
const pathname = context.url.pathname;
const isPublic =
  pathname === "/" || PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

if (!isPublic && !context.locals.user) {
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const returnTo = encodeURIComponent(pathname + context.url.search);
  return context.redirect(`/auth/signin?returnTo=${returnTo}`);
}
```

The `PROTECTED_ROUTES` constant is removed entirely. The `PUBLIC_ROUTES` constant replaces it.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Visiting `/dashboard` while logged out redirects to `/auth/signin?returnTo=%2Fdashboard`
- Visiting `/generate` (does not exist yet) while logged out redirects to `/auth/signin?returnTo=%2Fgenerate`
- `curl -X POST http://localhost:4321/api/cards` (non-existent route) while logged out returns `{"error":"Unauthorized"}` with HTTP 401
- `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` load without auth
- `/api/auth/signin` accepts unauthenticated POST (login still works)
- Logged-in user can access `/dashboard` normally
- No redirect loop: visiting `/auth/signin` while logged out loads the page, not another redirect

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Thread returnTo Through Signin Flow

### Overview

Propagate the `returnTo` query param from the signin page URL into the form POST body, and read it in the API handler to redirect the user to their original destination after successful authentication.

### Changes Required

#### 1. Signin page — pass returnTo to form

**File**: `src/pages/auth/signin.astro`

**Intent**: Read the `returnTo` query param from the URL (placed there by middleware) and forward it to `SignInForm` as a prop so it can be included in the form submission.

**Contract**: Extract `Astro.url.searchParams.get("returnTo") ?? "/"` and pass it as a new `returnTo` prop to `<SignInForm ... returnTo={returnTo} client:load />`.

#### 2. SignInForm — include returnTo as hidden field

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Accept the `returnTo` destination and carry it through the form POST so the API handler can read it.

**Contract**: Add `returnTo?: string` to the `Props` interface (line 8–10). Render `<input type="hidden" name="returnTo" value={returnTo ?? "/"} />` inside the `<form>` element, before the submit button.

#### 3. Signin API handler — sanitize and redirect to returnTo

**File**: `src/pages/api/auth/signin.ts`

**Intent**: After successful authentication, redirect the user to their originally intended destination rather than always sending them to `/`.

**Contract**: Read `returnTo` from form data after the existing email/password reads. Apply the sanitization rule: `raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/"`. Replace the hardcoded `context.redirect("/")` (line 18) with `context.redirect(sanitizedReturnTo)`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Log out → visit `/dashboard` → redirected to `/auth/signin?returnTo=%2Fdashboard` → sign in → land on `/dashboard`
- Manually craft `?returnTo=//evil.com` → sign in → land on `/` (not the external domain)
- Manually craft `?returnTo=https://evil.com` → sign in → land on `/`
- Sign in from `/auth/signin` directly (no `returnTo`) → land on `/`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the full flow works end-to-end.

---

## Testing Strategy

### Manual Testing Steps

1. Start dev server: `npm run dev`
2. Open a private/incognito window (no session)
3. Visit `http://localhost:4321/dashboard` → verify redirect to `/auth/signin?returnTo=%2Fdashboard`
4. Sign in with a valid account → verify landing on `/dashboard`
5. Sign out; visit `/auth/signin?returnTo=//evil.com` → sign in → verify landing on `/`
6. Sign out; `curl -X POST http://localhost:4321/api/test-401` → verify 401 JSON (the route doesn't need to exist — 404 response will pass through middleware first, but you can test with any future API route)
7. While logged out, verify `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` load normally
8. While logged in, verify `/dashboard` loads normally and sign-out still works

## References

- Roadmap: `context/foundation/roadmap.md` — F-01 section
- Linear ticket: [10X-5](https://linear.app/10x-cards-kb/issue/10X-5/extend-auth-middleware-to-gate-all-product-routes)
- Middleware: `src/middleware.ts`
- Signin form: `src/components/auth/SignInForm.tsx`
- Signin API: `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rewrite Middleware to Negative Allow-List

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 692eaf6
- [x] 1.2 Build passes: `npm run build` — 692eaf6

#### Manual

- [x] 1.3 `/dashboard` logged-out redirects with `?returnTo=%2Fdashboard` — 692eaf6
- [x] 1.4 `/generate` (non-existent) logged-out redirects with `?returnTo=%2Fgenerate` — 692eaf6
- [x] 1.5 Unauthenticated POST to `/api/*` returns HTTP 401 JSON — 692eaf6
- [x] 1.6 Public routes (`/`, `/auth/*`, `/api/auth/*`) load without auth — 692eaf6
- [x] 1.7 Logged-in user accesses `/dashboard` normally, no redirect loop on `/auth/signin` — 692eaf6

### Phase 2: Thread returnTo Through Signin Flow

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 1e66647
- [x] 2.2 Build passes: `npm run build` — 1e66647

#### Manual

- [x] 2.3 Full flow: log out → visit `/dashboard` → sign in → land on `/dashboard` — 1e66647
- [x] 2.4 Open-redirect blocked: `?returnTo=//evil.com` → land on `/` — 1e66647
- [x] 2.5 Open-redirect blocked: `?returnTo=https://evil.com` → land on `/` — 1e66647
- [x] 2.6 Direct signin (no `returnTo`) → land on `/` — 1e66647
