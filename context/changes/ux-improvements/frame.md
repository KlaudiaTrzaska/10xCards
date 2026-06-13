# Frame Brief: UX Improvements (S-06)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Roadmap S-06 bundles three UX gaps: bulk curation actions, study session
reset, and clearer loading states during async operations. User dogfoods the
app and finds reviewing 10–15 AI-generated draft flashcards one-by-one
tedious on `/generate`.

## Initial Framing (preserved)

- **User's stated cause or approach**: Three planned UX polish items from
  `context/foundation/roadmap.md` — ship them together as slice S-06.
- **User's proposed direction**: Add bulk curation shortcuts, a study
  session reset affordance, and consistent loading states across async flows.
- **Pre-dispatch narrowing**: Leading concern is **curation tedium** when
  reviewing many AI drafts; driven by **personal dogfooding**, not a specific
  user-reported incident.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Interaction model (per-card clicks)** — no Accept all / Discard all /
   progress affordances; decision work scales O(n) with card count.
   ← user's current framing (bulk curation)
2. **API / atomicity constraint** — S-02's single `save-deck` call might
   force per-card UI even when bulk would be faster.
3. **Prior design policy** — S-02 deliberately rejected bulk shortcuts to
   protect the ≥75% draft-acceptance metric and curator-quality hypothesis.
4. **Layout / workflow friction** — long single-page scroll, Save button at
   list bottom (planned sticky footer not implemented), no "X of N decided"
   indicator.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Interaction model lacks bulk shortcuts | `CurationPanel.tsx:184-234` — per-card Accept/Edit/Discard only; zero bulk UI in repo; 10–15 accept-all = 15 clicks + 1 save | **STRONG** |
| API atomicity blocks bulk UI | `save-deck.ts:64-70` — `accepted: UUID[]` bulk UPDATE already; `CurationPanel.tsx:48-62` — single POST funnel; S-02 plan explicitly deferred bulk as UI scope, not API | **NONE** (ruled out) |
| Prior policy intentionally forbids bulk | `atomic-save-to-deck/plan-brief.md:28` — "Accept all shortcut \| No \| Per-card review aligns with ≥75% metric"; `prd.md:FR-005` Socrates note | **STRONG** (intentional) |
| Layout amplifies tedium beyond clicks | `GenerateForm.tsx:60-157` — form stays above list; `CurationPanel.tsx:242-270` — Save at bottom, no sticky; plan.md:228 specified sticky footer — not shipped | **WEAK** (amplifier, not root) |

Independent cross-check (agent `1d8ab878`) landed on the same top causes:
per-card triage × default batch size (10) without bulk shortcuts, plus
layout friction.

## Narrowing Signals

- User picked **bulk curation tedium** over study reset and loading states.
- Driver is **dogfooding**, not external user feedback — friction is real but
  unvalidated at scale.
- API investigation rules out backend rework; bulk accept is a **UI-only**
  change within existing staged-batch model.
- S-02's "no Accept all" was a **product policy choice**, not a technical
  blocker — S-06 re-opens that policy without yet documenting the tradeoff.

## Cross-System Convention

S-02 established staged batch curation: local decisions → single Save → atomic
DB commit. This convention should be preserved (roadmap S-06 risk note).
Bulk shortcuts fit inside that model (populate `decisions` Map, same
`handleSave()`). What changes is the **interaction layer**, not save
semantics.

The PRD optimizes **paste → first accepted card** (<5 min), not **full-batch
review time**. S-02 aligned UI with per-card quality filtering; dogfooding
suggests the bottleneck has shifted to **finishing a full batch** when draft
quality is high enough to trust bulk triage.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: curation decision friction when
> reviewing full AI draft batches — S-02's intentional per-card-only UI creates
> O(n) click work that dogfooding exposes as tedious, while the save API
> already supports bulk accept without backend changes.

The initial roadmap framing (three equal UX items in one slice) should be
**split by priority**: bulk curation is the verified leading concern;
study session reset and loading-state polish are secondary items that may
ship in the same slice only if they don't dilute the curation fix.

Bulk actions are not a reversal of atomic save — they are a **re-litigation
of S-02's quality-vs-speed policy**. The plan must decide how bulk shortcuts
preserve meaningful curation (e.g., accept-all-undecided vs accept-all-including-discarded,
progress indicator, optional confirmation) without gaming the ≥75%
acceptance metric.

## Confidence

**HIGH** for bulk curation as the leading problem and UI-only fix path.

**MEDIUM** for bundling study reset + loading states in the same plan —
user did not flag them as primary; they can follow or ship in parallel only
if scope stays tight.

## What Changes for /10x-plan

Plan around **curation throughput** first: bulk Accept all / Discard all (or
accept-all-remaining) within `CurationPanel`, preserving staged-batch save
and S-02 API contract. Treat study reset and loading states as secondary
scope — include only if low-effort or explicitly requested; do not let them
drive the plan's critical path.

Reconcile the S-02 quality guardrail explicitly: document why bulk shortcuts
are safe now (dogfood signal + speed metric) and what UX safeguards prevent
blind mass-accept.

## References

- Source files: `src/components/generation/CurationPanel.tsx`, `src/components/generation/GenerateForm.tsx`, `src/pages/api/save-deck.ts`
- Prior decisions: `context/changes/atomic-save-to-deck/plan-brief.md:28,43`, `context/foundation/prd.md:FR-005`
- Roadmap: `context/foundation/roadmap.md:S-06`
- Investigation tasks: `7a3fe067`, `cef7473d`, `6032af45`, `1d8ab878`
