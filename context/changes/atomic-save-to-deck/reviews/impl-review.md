<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Atomic Save to Deck (S-02)

- **Plan**: `context/changes/atomic-save-to-deck/plan.md`
- **Scope**: Phases 1-3 of 3
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 5 warnings 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Save endpoint can over-report saved cards

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/save-deck.ts:51`
- **Detail**: Mutations are scoped by `user_id` and `generation_id`, which protects cross-user writes, but the route never verifies that every requested card ID matched a row. Supabase updates/deletes that affect zero rows do not error, while `savedCount` is computed from request lengths. Stale, duplicate, deleted, or wrong-generation IDs can be reported as saved.
- **Fix**: Validate the full requested card ID set for the user/generation before mutating, reject mismatches, and compute the response from validated unique accepted/edited IDs.
  - Strength: Keeps the existing route shape while making success mean the requested cards really belonged to this generation.
  - Tradeoff: Adds a preflight query and duplicate-ID handling before the three mutation steps.
  - Confidence: HIGH — current code returns `accepted.length + edited.length` regardless of affected rows.
  - Blind spot: Not verified against live Supabase row-count behavior in this environment.
- **Decision**: PENDING

### F2 — Save operation is not truly atomic

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/save-deck.ts:51`
- **Detail**: The route deletes discarded cards, then accepts cards, then updates edited cards. If a later step fails, earlier mutations remain committed. The plan explicitly chose idempotent sequential operations over a Postgres RPC, so this is partly a plan risk, not just implementation drift.
- **Fix A ⭐ Recommended**: Add full target validation first and keep the sequential writes for MVP.
  - Strength: Reduces false-success and stale-ID cases without introducing an RPC boundary not planned for this slice.
  - Tradeoff: Still not transactional if Supabase fails after some writes.
  - Confidence: MED — improves the biggest practical risk, but does not make the operation truly atomic.
  - Blind spot: Need product input on whether partial success is acceptable.
- **Fix B**: Move the curation save into a Postgres RPC transaction.
  - Strength: Aligns the "atomic save" name with database behavior and prevents partial mutation states.
  - Tradeoff: Expands scope beyond the plan's explicit MVP decision.
  - Confidence: HIGH — a DB transaction is the correct primitive for true all-or-nothing behavior.
  - Blind spot: Would need Supabase migration verification locally.
- **Decision**: PENDING

### F3 — Edited content can be whitespace-only

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/save-deck.ts:16`
- **Detail**: `z.string().min(1)` accepts strings like `"   "`, and the curation UI sends raw edited values. Users can save blank-looking front/back card content.
- **Fix**: Use trimmed server-side validation, for example `z.string().trim().min(1).max(1000)`, and trim edits before sending or confirming in the client.
- **Decision**: PENDING

### F4 — Edit cancel does not restore the previous decision

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/generation/CurationPanel.tsx:160`
- **Detail**: The plan says canceling edit reverts the card to its pre-edit state. The implementation overwrites the previous decision with `editing`, then Cancel calls `setDecision(card.id, null)`, so canceling from accepted/discarded/edited returns the card to undecided.
- **Fix**: Preserve the prior decision when entering edit mode, or make Cancel restore the previous action instead of always clearing the decision.
- **Decision**: PENDING

### F5 — New generation submit does not clear stale generationId

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/generation/GenerateForm.tsx:34`
- **Detail**: The plan says new submit/reset should clear both `cards` and `generationId`. New submit clears `cards` but leaves `generationId` until a new response arrives. The panel is gated on both values, so this is low risk, but it is still stale state.
- **Fix**: Add `setGenerationId(null)` next to `setCards(null)` when a new generation request starts.
- **Decision**: PENDING

### F6 — Pre-existing generate error exposure still violates the new lesson

- **Severity**: 👀 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/generate.ts:47`
- **Detail**: The S-02 range touched `generate.ts` only to use the shared JSON helper, so this is not new S-02 behavior. It is still present in the reviewed area and conflicts with the recorded lesson about not exposing upstream provider details to clients.
- **Fix**: Return a generic `Generation failed` response while logging detailed provider errors server-side.
- **Decision**: PENDING

## Verification

- `npm run lint`: PASS
- `npm run build`: PASS
- Manual checks in the plan are marked complete.
- Later commits changed the dashboard/deck destination after S-02; this was not counted as S-02 drift.
