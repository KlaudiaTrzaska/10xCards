---
project: "10xCards"
repo: "KlaudiaTrzaska/10xCards"
milestone: "MVP"
milestone_url: "https://github.com/KlaudiaTrzaska/10xCards/milestone/1"
created: 2026-06-05
source: "context/foundation/roadmap.md"
---

# GitHub Issues: 10xCards MVP

> Generated from `context/foundation/roadmap.md` (v1).
> Repo: [KlaudiaTrzaska/10xCards](https://github.com/KlaudiaTrzaska/10xCards)
> Milestone: [MVP](https://github.com/KlaudiaTrzaska/10xCards/milestone/1)

## Labels

| Label | Color | Purpose |
|---|---|---|
| `foundation` | `#0052cc` | F-xx items — infra and auth foundations |
| `slice` | `#5319e7` | S-xx items — user-facing feature slices |
| `status: ready` | `#0e8a16` | Ready for `/10x-plan` immediately |
| `status: proposed` | `#fbca04` | Proposed — open questions remain |
| `status: blocked` | `#b60205` | Blocked pending a key decision |

## Issues

| Roadmap ID | GitHub # | Title | Labels | URL |
|---|---|---|---|---|
| F-01 | #2 | Extend auth middleware to gate all product routes | `foundation`, `status: ready` | https://github.com/KlaudiaTrzaska/10xCards/issues/2 |
| F-02 | #3 | Set up CI deploy step and Workers Secrets | `foundation`, `status: ready` | https://github.com/KlaudiaTrzaska/10xCards/issues/3 |
| S-01 | #4 | AI card generation behind auth gate | `slice`, `status: proposed` | https://github.com/KlaudiaTrzaska/10xCards/issues/4 |
| S-02 | #5 | Curation flow with atomic save to deck | `slice`, `status: proposed` | https://github.com/KlaudiaTrzaska/10xCards/issues/5 |
| S-03 | #6 | Deck browsing, manual create, edit and delete | `slice`, `status: proposed` | https://github.com/KlaudiaTrzaska/10xCards/issues/6 |
| S-04 | #7 | Study session with SR algorithm and review outcomes | `slice`, `status: blocked` | https://github.com/KlaudiaTrzaska/10xCards/issues/7 |
| S-05 | #8 | Account deletion with 30-day data retention | `slice`, `status: proposed` | https://github.com/KlaudiaTrzaska/10xCards/issues/8 |

## Dependency graph

```
F-01 (#2) ──┬── S-01 (#4) ── S-02 (#5) ──┬── S-03 (#6)
            │                              └── S-04 (#7)
            └── S-05 (#8)

F-02 (#3)  (parallel with F-01, no downstream deps)
```
