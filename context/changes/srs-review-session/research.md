---
date: 2026-06-13T12:00:00+02:00
researcher: Cursor Agent
git_commit: f51c3e0dce15c9f23ca4c766b0b67f7c90cdd24a
branch: main
repository: 10xCards
topic: "Compatibility of ts-fsrs-docs.md with codebase for S-04 (srs-review-session)"
tags: [research, codebase, srs, ts-fsrs, s-04, srs-review-session]
status: complete
last_updated: 2026-06-13
last_updated_by: Cursor Agent
---

# Research: Compatibility of ts-fsrs-docs.md with codebase for S-04

**Date**: 2026-06-13T12:00:00+02:00
**Researcher**: Cursor Agent
**Git Commit**: f51c3e0dce15c9f23ca4c766b0b67f7c90cdd24a
**Branch**: main
**Repository**: 10xCards

## Research Question

Review the codebase and decide whether `context/changes/srs-review-session/ts-fsrs-docs.md` is compatible with it, in the context of implementing S-04 from `context/foundation/roadmap.md`.

## Summary

**Yes — `ts-fsrs-docs.md` is fully compatible with the current codebase.** More importantly, **S-04 is already implemented** on `main` (roadmap status: `done`, change status: `impl_reviewed` 2026-06-10). The live code matches the doc's API patterns, schema mapping, and end-to-end flow almost exactly.

The doc is not a greenfield spec — it is an accurate reference that mirrors what was built. All 8 checklist items in the doc are satisfied in code. You do **not** need to re-implement S-04 from scratch; use the doc as the authoritative ts-fsrs integration guide and the existing code as the reference implementation.

**Minor gaps** (documented in impl-review, not blockers for the doc's compatibility):

- `first_reviewed_at` uses JS `??` instead of SQL `COALESCE` (behaviorally equivalent in normal use)
- Non-transactional INSERT log + UPDATE card (orphan log risk on partial failure)
- No optimistic concurrency guard on `fsrs_reps` (TOCTOU under concurrent reviews)
- Phase 3 UI drift: client-side fetch instead of planned SSR in `study.astro`

## Detailed Findings

### ts-fsrs package & srs.ts service

- **Version**: `ts-fsrs@5.4.1` in `package.json` matches doc header (`ts-fsrs-docs.md:4`)
- **Scheduler init**: `fsrs(generatorParameters())` with defaults — doc lines 104–119
- **New card rule**: `fsrs_state IS NULL` → `createEmptyCard(now)` — `srs.ts:91–92`, doc lines 123–128
- **Rehydration**: `rehydrateCard()` maps all 9 DB columns to `Card` — `srs.ts:56–70`, doc lines 44–55
- **Grading**: Uses `scheduler.repeat(card, now)[rating]` — doc documents this as equivalent to `next()` — `srs.ts:95–97`, doc lines 133–150
- **Rating mapping**: again→1, hard→2, good→3, easy→4 — `srs.ts:43–54`, doc lines 59–65
- **Deprecated field**: `elapsed_days` correctly omitted — doc lines 54, 310–312
- **Review log subset**: 6 fields persisted (rating, state, stability, difficulty, scheduled_days, reviewed_at) — `srs.ts:101–108`, doc lines 203–212

### Database schema

| Doc mapping | Migration | Status |
|---|---|---|
| 9 `fsrs_*` columns on `flashcards` | `20260610100000_add_fsrs_columns_to_flashcards.sql:4–12` | ✓ |
| Due-card partial index | same migration `:14–18` | ✓ |
| `review_logs` (6 FSRS fields + FKs) | `20260610200000_create_review_logs.sql:11–16` | ✓ |
| Append-only RLS (SELECT + INSERT only) | same migration `:22–27` | ✓ |
| `first_reviewed_at` | `20260608000000_add_first_reviewed_at.sql:1–2` | ✓ |

Due-card query in doc (`ts-fsrs-docs.md:194–198`) matches API:

```23:30:src/pages/api/study/due.ts
  const { data, count, error } = await supabase
    .from("flashcards")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .eq("status", "accepted")
    .or(`fsrs_due.is.null,fsrs_due.lte.${now}`)
    .order("fsrs_due", { ascending: true, nullsFirst: true })
    .limit(SESSION_LIMIT);
```

### API routes & UI

| Doc flow step | Implementation | Status |
|---|---|---|
| `GET /api/study/due` | `src/pages/api/study/due.ts` | ✓ |
| `POST /api/study/review` | `src/pages/api/study/review.ts` | ✓ |
| scheduleReview → INSERT log → UPDATE card | `review.ts:72–111` | ✓ |
| `/study` React island | `src/pages/study.astro` + `StudySession.tsx` | ✓ |
| Flip → four grade buttons | `StudySession.tsx:254–278` | ✓ |

### Implementation checklist (ts-fsrs-docs.md:297–307)

| # | Item | Status |
|---|---|---|
| 1 | `npm install ts-fsrs` (v5.4.1) | ✓ `package.json:35` |
| 2 | Migration: 9 `fsrs_*` columns + due index | ✓ |
| 3 | Migration: `review_logs` append-only RLS | ✓ |
| 4 | `src/lib/services/srs.ts` | ✓ |
| 5 | `GET /api/study/due` — NULLS FIRST, LIMIT 20 | ✓ |
| 6 | `POST /api/study/review` — full pipeline | ✓ |
| 7 | `/study` React island — flip + grade | ✓ |
| 8 | Outcome → rating mapping | ✓ |

## Code References

- `src/lib/services/srs.ts:86–110` — `scheduleReview()` reference implementation (also quoted in doc)
- `src/pages/api/study/due.ts:8,23–30` — due-card query with SESSION_LIMIT=20
- `src/pages/api/study/review.ts:42–111` — review handler pipeline
- `src/components/study/StudySession.tsx` — flip-and-grade UI
- `src/types.ts:84–134` — `ReviewOutcome`, `StudyCardDTO`, request/response DTOs
- `supabase/migrations/20260610100000_add_fsrs_columns_to_flashcards.sql` — FSRS columns + index
- `supabase/migrations/20260610200000_create_review_logs.sql` — review history table

## Architecture Insights

- **Stateless session model**: No `review_sessions` table; each grade is an independent `POST /api/study/review` call. Matches doc sequence diagram and plan non-goals.
- **NULL-as-new semantics**: All `fsrs_*` columns NULL + `fsrs_state IS NULL` means "never reviewed"; `createEmptyCard()` is the only valid entry point for new cards.
- **Workers-compatible**: ts-fsrs is pure TypeScript with no native addons — suitable for Cloudflare Workers runtime.
- **Doc as living reference**: `ts-fsrs-docs.md` was written to consolidate ts-fsrs API knowledge mapped to this repo's schema; the code in `srs.ts` is the canonical implementation the doc describes.

## Historical Context (from prior changes)

- `context/changes/srs-review-session/plan.md` — three-phase plan (schema → API → UI); all phases marked done
- `context/changes/srs-review-session/plan-brief.md` — key decisions: ts-fsrs, stateless sessions, 9 nullable columns, NULLS FIRST ordering
- `context/changes/srs-review-session/reviews/impl-review.md` — verdict NEEDS ATTENTION (5 warnings, 5 observations); all decisions still PENDING
- `context/foundation/roadmap.md:119–129` — S-04 marked **done** (`impl_reviewed` 2026-06-10)

**Impl-review findings relevant to doc compatibility** (implementation exists but has quality gaps):

| ID | Issue | Doc says | Code does |
|---|---|---|---|
| F2 | first_reviewed_at | SQL COALESCE | JS `??` at `review.ts:94` |
| F3 | Atomicity | INSERT then UPDATE (diagram) | Separate Supabase calls |
| F5 | SSR data fetch | Planned in study.astro | Client fetch in StudySession |
| F1 | Concurrency | (not in doc) | No fsrs_reps guard |

These are implementation-quality notes, not doc/code incompatibilities.

## Related Research

- No prior `research.md` existed in this change folder before this audit.
- `context/changes/srs-review-session/ts-fsrs-docs.md` — the document under review (untracked in git as of this commit).

## Open Questions

1. **Why implement S-04 now?** Roadmap and change folder both mark it done. If the goal is verification, this research confirms compatibility. If code was lost or migrations not applied to remote Supabase, verify with `supabase db push` against hosted instance (per `lessons.md`).
2. **Should impl-review findings be addressed?** F1 (concurrency) and F3 (transactionality) are the highest-impact gaps for "schedule updated without losing history" (FR-009 NFR).
3. **Is `ts-fsrs-docs.md` ready to commit?** It accurately describes the implemented system and would serve future agents implementing SRS extensions (analytics, rollback, custom params).

## Recommendation

| Goal | Action |
|---|---|
| Implement S-04 from scratch | **Skip** — already on `main` |
| Use doc as integration guide | **Yes** — fully compatible |
| Ship S-04 to production | Verify migrations applied remotely; run manual study session test |
| Harden SRS | Address impl-review F1–F4 (concurrency, COALESCE, transaction, RLS) |
