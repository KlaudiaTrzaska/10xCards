---
project: "10xCards"
linear_workspace: "10x-cards-kb"
linear_project: "10xCards MVP"
linear_project_url: "https://linear.app/10x-cards-kb/project/10xcards-mvp-5692c6542046"
created: 2026-06-05
source: "context/foundation/roadmap.md"
---

# Linear Issues: 10xCards MVP

> Mirrored from `context/foundation/roadmap.md` (v1) and `context/foundation/tasks-github.md`.
> Workspace: `10x-cards-kb`
> Project: [10xCards MVP](https://linear.app/10x-cards-kb/project/10xcards-mvp-5692c6542046)
> Cross-reference: see `tasks-github.md` for GitHub issue numbers.

## Workspace

| Field | Value |
|---|---|
| Workspace slug | `10x-cards-kb` |
| Team ID | `ea37d222-231c-4cdf-8c27-cca3a73dbf0c` |
| Team key | `10X` |
| Project ID | `594eb7e3-f947-4e36-b698-6b884c529e17` |

## Labels created

| Label | Color | Scope | Purpose |
|---|---|---|---|
| `foundation` | `#0052cc` | team | F-xx items — infra and auth foundations |
| `slice` | `#5319e7` | team | S-xx items — user-facing feature slices |

Status mapping (Linear states used in place of GitHub status labels):

| Roadmap status | Linear state |
|---|---|
| `status: ready` | **Todo** |
| `status: proposed` | **Backlog** |
| `status: blocked` | **Backlog** + native `blockedBy` relation |

## Issues

| Roadmap ID | Linear ID | Title | State | Labels | URL |
|---|---|---|---|---|---|
| F-01 | 10X-5 | Extend auth middleware to gate all product routes | Todo | `foundation` | https://linear.app/10x-cards-kb/issue/10X-5/extend-auth-middleware-to-gate-all-product-routes |
| F-02 | 10X-6 | Set up CI deploy step and Workers Secrets | Todo | `foundation` | https://linear.app/10x-cards-kb/issue/10X-6/set-up-ci-deploy-step-and-workers-secrets |
| S-01 | 10X-7 | AI card generation behind auth gate | Backlog | `slice` | https://linear.app/10x-cards-kb/issue/10X-7/ai-card-generation-behind-auth-gate |
| S-02 | 10X-8 | Curation flow with atomic save to deck | Backlog | `slice` | https://linear.app/10x-cards-kb/issue/10X-8/curation-flow-with-atomic-save-to-deck |
| S-03 | 10X-9 | Deck browsing, manual create, edit and delete | Backlog | `slice` | https://linear.app/10x-cards-kb/issue/10X-9/deck-browsing-manual-create-edit-and-delete |
| S-04 | 10X-10 | Study session with SR algorithm and review outcomes | Backlog | `slice` | https://linear.app/10x-cards-kb/issue/10X-10/study-session-with-sr-algorithm-and-review-outcomes |
| S-05 | 10X-11 | Account deletion with 30-day data retention | Backlog | `slice` | https://linear.app/10x-cards-kb/issue/10X-11/account-deletion-with-30-day-data-retention |

## Blocking relations (native Linear `blockedBy`)

| Issue | Blocked by | Reason |
|---|---|---|
| 10X-7 (S-01) | 10X-5 (F-01) | Generation route requires auth gate to exist first |
| 10X-8 (S-02) | 10X-7 (S-01) | Curation requires generated drafts from S-01 |
| 10X-9 (S-03) | 10X-8 (S-02) | Deck management requires accepted cards from S-02 |
| 10X-10 (S-04) | 10X-8 (S-02) | Study session requires deck populated via S-02 |
| 10X-11 (S-05) | 10X-5 (F-01) | Account deletion requires identity from auth gate |

## Dependency graph

```
F-01 (10X-5) ──┬── S-01 (10X-7) ── S-02 (10X-8) ──┬── S-03 (10X-9)
               │                                     └── S-04 (10X-10)
               └── S-05 (10X-11)

F-02 (10X-6)  (parallel with F-01, no downstream deps)
```

## GitHub cross-reference

Each Linear issue has a GitHub issue attached as a link attachment (visible in the sidebar under "Links"). See `tasks-github.md` for the full GitHub side of the registry.

| Linear ID | GitHub URL |
|---|---|
| 10X-5 | https://github.com/KlaudiaTrzaska/10xCards/issues/2 |
| 10X-6 | https://github.com/KlaudiaTrzaska/10xCards/issues/3 |
| 10X-7 | https://github.com/KlaudiaTrzaska/10xCards/issues/4 |
| 10X-8 | https://github.com/KlaudiaTrzaska/10xCards/issues/5 |
| 10X-9 | https://github.com/KlaudiaTrzaska/10xCards/issues/6 |
| 10X-10 | https://github.com/KlaudiaTrzaska/10xCards/issues/7 |
| 10X-11 | https://github.com/KlaudiaTrzaska/10xCards/issues/8 |
