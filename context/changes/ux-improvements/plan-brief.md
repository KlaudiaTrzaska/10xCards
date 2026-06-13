# UX Improvements (S-06) — Plan Brief

> Full plan: `context/changes/ux-improvements/plan.md`
> Frame brief: `context/changes/ux-improvements/frame.md`

## What & Why

Curation decision friction when reviewing full AI draft batches — S-02's
intentional per-card-only UI creates O(n) click work that dogfooding exposes
as tedious, while the save API already supports bulk accept without backend
changes. This plan also closes secondary roadmap gaps: mid-session study exit
and consistent loading feedback on product async flows.

## Starting Point

`CurationPanel` stages per-card Accept/Edit/Discard in a `Map` and commits via
one `POST /api/save-deck` call. No bulk shortcuts exist. `StudySession` has no
exit during review (reviews persist immediately). Loading spinners are
inconsistent — generation/curation have them; deck load and card save do not.

## Desired End State

User accepts or discards all remaining undecided drafts in one click, sees
decision progress and a sticky Save footer, can end a study session early
(reviews kept), and sees spinners on deck load, card save, and grade submit.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Leading priority | Bulk curation first | Frame confirmed dogfood pain is curation throughput, not study/loading | Frame |
| Bulk semantics | Accept/Discard all **undecided only** | Preserves per-card work; safe default per frame tradeoff analysis | Plan |
| Bulk confirmation | None | User chose speed over modal friction for undecided-only scope | Plan |
| Study reset | End session → `/deck` | Reviews already persisted; zero API work; matches NFR | Plan |
| Plan structure | 2 phases (curation, then polish) | Critical path first; secondary items don't dilute Phase 1 | Plan |
| Loading scope | Product flows only | DeckManager, CardModal, StudySession grade submit — not auth/settings | Plan |
| Spinner pattern | Inline (no shared component) | Matches existing GenerateForm/CurationPanel markup | Plan |
| API changes | None | `save-deck` already accepts bulk `accepted[]`; S-02 contract preserved | Frame |

## Scope

**In scope:**
- `CurationPanel.tsx` — Accept all remaining, Discard all remaining, progress header, sticky footer
- `StudySession.tsx` — End session link, grade-submit spinner
- `DeckManager.tsx` — loading spinner
- `CardModal.tsx` — save spinner

**Out of scope:**
- API/DB changes, discard-only save, confirmation modals, shared spinner component
- Auth/settings loading polish, keyboard shortcuts, automated tests

## Architecture / Approach

Bulk actions populate the existing `decisions` Map client-side; `handleSave()`
unchanged. Undecided = no Map entry; bulk skips `accepted`, `discarded`,
`edited`, and `editing` cards. Study exit is `window.location.href = "/deck"`.
Loading polish copies the inline spinner markup from `GenerateForm.tsx` into
three components.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bulk Curation Throughput | Bulk shortcuts, progress, sticky Save | Discard-all with zero accepts still can't save (S-02 constraint) |
| 2. Study Exit + Loading Polish | End session, spinners on deck/modal/study | End session must not imply review rollback |

**Prerequisites:** S-02 (curation), S-04 (study) implemented  
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- Bulk accept may inflate measured acceptance rate vs per-card review — acceptable per frame re-litigation of S-02 policy
- Discard-all remaining with no accepts still leaves Save disabled — pre-existing; hint text optional if confusing
- Dogfood-driven; no production user validation yet

## Success Criteria (Summary)

- User triages a 10–15 card batch with bulk actions and commits via existing Save
- User exits study mid-session; prior reviews persist
- Deck, modal, and study async operations show consistent spinner feedback
