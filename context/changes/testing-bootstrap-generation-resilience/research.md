---
date: 2026-06-20T21:12:00+02:00
researcher: AI Agent
git_commit: 1cc84ced8b68bde24d145aef11c30d3eeb2664db
branch: cursor/add-test-plan
repository: 10xCards
topic: "LLM provider returns invalid/malformed output — generation flow crash and garbage draft cards"
tags: [research, codebase, generation, llm, openrouter, validation, error-handling]
status: complete
last_updated: 2026-06-20
last_updated_by: AI Agent
---

# Research: LLM Malformed-Response Handling in the Generation Flow

**Date**: 2026-06-20T21:12:00+02:00
**Researcher**: AI Agent
**Git Commit**: `1cc84ced8b68bde24d145aef11c30d3eeb2664db`
**Branch**: `cursor/add-test-plan`
**Repository**: 10xCards

---

## Research Question

Risk #1 from `context/foundation/test-plan.md`:

> LLM provider returns invalid/malformed output and the generation flow crashes or shows garbage instead of draft cards.

Ground the full failure path from HTTP request → OpenRouter → response parsing → Zod validation → persistence → UI rendering. Verify or correct the test plan's response guidance. Locate the cheapest useful test layer and the anti-patterns to avoid.

---

## Summary

The generation pipeline is a single, end-to-end chain spanning three files (`generate.ts`, `generation.ts`, `GenerateForm.tsx`). It has five real failure modes that tests must cover — three silent or leaking, two already well-handled — plus one confirmed active bug (provider error body leaks to the client verbatim). No tests exist today; the test base is `none`.

**Confirmed active gaps (Risk #1):**

| # | Gap | Severity |
|---|-----|----------|
| 1 | Raw OpenRouter error body leaks to client on 502 | High — exposes provider internals, violates `lessons.md` rule |
| 2 | Whitespace-only card fields pass Zod `min(1)` and are persisted | Medium — garbage cards stored and shown |
| 3 | Fewer cards than requested passes silently — no count check | Medium — user sees truncated deck with no indication |
| 4 | `undefined` `cards`/`generationId` on HTTP 200 crashes CurationPanel | Medium — unguarded `!== null` check in GenerateForm |
| 5 | No explicit empty-array UI state (zero-card panel with no message) | Low |

**Already protected (no new test needed):**

- Malformed JSON envelope → `GenerationError("Failed to parse OpenRouter response as JSON")`
- Non-JSON model content → `GenerationError("Model returned non-JSON content")`
- Wrong schema (missing `cards`, empty array, missing `front`/`back`) → `GenerationError("Model response failed schema validation")`
- Missing `choices[0].message.content` → `GenerationError("OpenRouter response missing...")`
- Network failure → `GenerationError("Failed to reach OpenRouter")`
- Unexpected non-`GenerationError` → generic 500

These paths throw correctly and return a non-200 response; the client shows the error banner.

**Risk #7 (oversized paste):**
- Input validation is in place at both layers (client: `GenerateForm.tsx:25-31`; server: `RequestSchema` min 50 / max 10,000, `generate.ts:11-14`).
- Server gate returns 400 with the Zod issue message.
- The primary gap is a missing unit test that proves these limits hold; the boundary itself works.

**Cheapest useful test layer (confirmed):** unit tests for `generateCards()` with a mocked `fetch`, plus one integration test for the API route proving the 502 error message does NOT contain raw provider body. That is the entire Risk #1 coverage. e2e is not needed.

---

## Detailed Findings

### A. The Generation Pipeline (end-to-end)

```
GenerateForm.tsx → POST /api/generate → generateCards() → OpenRouter → parsing chain → DB → GenerateResponseDTO → CurationPanel.tsx
```

#### A.1 Input validation at the API boundary

`src/pages/api/generate.ts:11-14`

```typescript
const RequestSchema = z.object({
  sourceText: z.string().min(50).max(10_000),
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]),
});
```

`generate.ts:27-35`: `safeParse` → 400 on failure. Request body JSON parse error → 400. No `sourceText` reaches the LLM if it fails these checks.

#### A.2 OpenRouter HTTP call

`src/lib/services/generation.ts:32-45`

- URL: `https://openrouter.ai/api/v1/chat/completions`
- Model: `openai/gpt-4o-mini`
- `response_format: { type: "json_object" }` — instructs the model to return valid JSON
- Card count is in the **system prompt string only** (`"generate exactly ${count} flashcards"`) — it is not a structured API constraint

Consequence: the model can return any count; the only enforcement is `slice(0, count)` after Zod validation.

#### A.3 Five-step response parsing chain

`src/lib/services/generation.ts:46-82`

| Step | Code | Input | Output on failure |
|------|------|-------|-------------------|
| 1. HTTP check | `46-54` | `response.ok` | `GenerationError("OpenRouter returned ${status}: ${rawBody}")` |
| 2. Envelope JSON | `56-61` | `response.json()` | `GenerationError("Failed to parse OpenRouter response as JSON", err)` |
| 3. Content extract | `63-68` | `choices?.[0]?.message?.content` | `GenerationError("OpenRouter response missing choices[0].message.content")` |
| 4. Model JSON | `70-75` | `JSON.parse(content)` | `GenerationError("Model returned non-JSON content", err)` |
| 5. Zod validate | `77-80` | `ResponseSchema.safeParse(parsed)` | `GenerationError("Model response failed schema validation", result.error)` |

Step 6: `generation.ts:82` — `result.data.cards.slice(0, count)` — return `CardCandidate[]`.

#### A.4 Zod schemas (private to generation.ts)

`generation.ts:18-25`

```typescript
const CardSchema = z.object({
  front: z.string().min(1),   // single space PASSES
  back: z.string().min(1),    // single space PASSES
});
const ResponseSchema = z.object({
  cards: z.array(CardSchema).min(1),  // min 1 card, NOT min(count)
});
```

Two confirmed gaps:
1. `min(1)` without `.trim()` — whitespace-only strings pass. `" "` (length 1) is valid.
2. `min(1)` not `min(count)` — 3 cards when 10 requested passes validation.

#### A.5 API route error translation

`generate.ts:41-51`

```typescript
} catch (err) {
  if (err instanceof GenerationError) {
    console.error("[generate] GenerationError:", err.message, err.cause);
    return json({ error: `Generation failed: ${err.message}` }, 502);   // ← leaks message
  }
  console.error("[generate] Unexpected error:", err);
  return json({ error: "Unexpected error during generation" }, 500);
}
```

The `GenerationError` from Step 1 (`"OpenRouter returned 401: {\"error\":{\"message\":\"Invalid API key\"}}"`) is embedded verbatim in the 502 body. `lessons.md` already flags this as a known problem at `generate.ts:47`.

`err.cause` is logged server-side only — does not leak.

#### A.6 Post-validation persistence

`generate.ts:74-88`

```typescript
candidates.map((c) => ({
  user_id: user.id,
  generation_id: generationRow.id,
  front: c.front,         // no re-validation, no trim
  back: c.back,
  status: "draft" as const,
}))
```

Whitespace-only `front`/`back` would be persisted here unchanged and returned in `cards`.

#### A.7 Frontend success-path gaps

`src/components/generation/GenerateForm.tsx:45-51`

```typescript
const data = (await res.json()) as GenerateResponseDTO & { error?: string };
if (!res.ok) {
  setError(data.error ?? "Something went wrong. Please try again.");
} else {
  setCards(data.cards);
  setGenerationId(data.generationId);
}
```

- TypeScript cast only — no runtime validation of the success payload.
- Guard at `GenerateForm.tsx:147`: `cards !== null && generationId !== null` — `undefined !== null` is `true`, so if the API mistakenly returned 200 with missing fields, `CurationPanel` mounts.
- `CurationPanel.tsx:35`: `cards.filter(...)` → runtime crash if `cards` is `undefined`.
- If `cards` is `[]`, the panel renders with "0 of 0 decided" and no dedicated empty-state message.

---

## Code References

- `src/lib/services/generation.ts:8-16` — `GenerationError` class definition
- `src/lib/services/generation.ts:18-25` — `CardSchema` and `ResponseSchema` (private Zod schemas)
- `src/lib/services/generation.ts:27-82` — `generateCards()` full function
- `src/lib/services/generation.ts:51-53` — **raw error body embedded in GenerationError.message**
- `src/lib/services/generation.ts:63-68` — unsafe cast + `!content` check (whitespace-only passes)
- `src/lib/services/generation.ts:77-80` — Zod safeParse (schema validation)
- `src/lib/services/generation.ts:82` — `slice(0, count)` — silent count truncation, no minimum
- `src/pages/api/generate.ts:11-14` — input `RequestSchema` (sourceText 50-10,000, count 5|10|15)
- `src/pages/api/generate.ts:41-51` — error translation: `GenerationError` → 502 (leaks message), unknown → 500
- `src/pages/api/generate.ts:74-88` — persist `candidates` to `flashcards` table without re-validation
- `src/components/generation/GenerateForm.tsx:25-31` — client-side input validation
- `src/components/generation/GenerateForm.tsx:39-57` — fetch call + response handling
- `src/components/generation/GenerateForm.tsx:45` — unsafe `as GenerateResponseDTO` cast
- `src/components/generation/GenerateForm.tsx:147` — `!== null` guard (passes `undefined`)
- `src/components/generation/CurationPanel.tsx:35` — `cards.filter()` — crashes on `undefined`
- `src/types.ts:40-43` — `GenerateResponseDTO { generationId: string; cards: Flashcard[] }`

---

## Architecture Insights

### The generation flow is a pure waterfall with a single catch boundary

The API route catches all `generateCards()` failures in one `try/catch`. This is good for robustness but means the error message surface is one string per failure mode. The five `GenerationError` messages are the only observable outcomes for test assertions — tests should assert on **status code + whether the error message leaks provider content**, not on the exact wording.

### `response_format: { type: "json_object" }` reduces but does not eliminate malformed JSON

OpenRouter/gpt-4o-mini will generally return valid JSON when `response_format` is set. However:
- The model can still return JSON with the wrong schema (no `cards` key, wrong types, whitespace values).
- The outer envelope is always the OpenRouter chat-completion shape; only the *content string* is model JSON.
- Two `JSON.parse` calls are needed: one for the envelope, one for `content`.

### Count enforcement is prompt-only — no API or Zod guarantee

The system prompt asks for "exactly N flashcards." The schema requires `min(1)`. There is no `min(count)` or `max(count)` in the schema. Both under-delivery and over-delivery are silent at the service layer. Over-delivery is truncated by `slice`; under-delivery reaches the DB.

### Whitespace-only fields are a known team concern

`lessons.md` ("Normalize and validate model output before persistence") already identifies `generation.ts:18` as the site and flags the problem. The rule section is incomplete (`TODO`), but the context is clear. Tests should confirm the fix once applied.

### No test infrastructure exists

`context/foundation/test-plan.md §4`: "Vitest — none yet, Phase 1 bootstraps". Confirmed — no `vitest.config.*`, `jest.config.*`, or `*.test.*`/`*.spec.*` files exist in the repo. Phase 1 starts from zero.

---

## Historical Context

- `context/foundation/lessons.md` — two directly relevant entries:
  - **"Do not expose upstream provider errors to clients"** (`generate.ts:47`) — the 502 leak is known; the fix rule is marked `TODO`.
  - **"Normalize and validate model output before persistence"** (`generation.ts:18`) — whitespace gap is known; the fix rule is also `TODO`.
- `context/foundation/test-plan.md §2` — Risk #1 response guidance cited "OpenRouter call site, response parsing/validation, error translation to UI" as context needed. Research confirms all three are in scope and adds: card-count enforcement, whitespace normalization, and the frontend null-guard gap.

---

## Verified Risk Response Guidance (updated from research)

### Risk #1 — LLM malformed output

| Cell | Test-plan value | Research verdict |
|------|----------------|-----------------|
| What would prove protection | Invalid LLM JSON/shape → user sees clear error, no crash, no partial corrupt drafts stored | **Confirmed**. Also add: whitespace-only fields produce error (not stored), fewer cards than requested produces count-mismatch error (or explicit count validation). |
| Must challenge | "OpenRouter always returns valid JSON" | **Confirmed**. Also challenge: "the error message is safe to show" (it contains raw provider body). |
| Context to ground | OpenRouter call site, response parsing/validation, error translation to UI | **Grounded**. All three are in `generation.ts` + `generate.ts`. Add: `GenerateForm.tsx` null-guard and empty-array UI state. |
| Cheapest layer | unit + integration (mock HTTP edge only) | **Confirmed**. Mock `fetch` in unit tests for `generateCards()`; one integration test for the API route verifying 502 does not contain raw provider body. |
| Anti-pattern to avoid | Asserting against production parser output; happy-path-only with real API | **Confirmed**. Also: do not re-implement Zod validation logic in test assertions — assert on error message + status code only. |

### Backport correction for §2 Source column

The hot-spot evidence cited `src/components/generation/` (6 commits/30d). Research shows the failure paths live in `src/lib/services/generation.ts` and `src/pages/api/generate.ts`. The hot-spot *directory* is correct evidence for likelihood; the exact failure sites are in the service and route files. No §2 anchor to strip — the plan already uses directory-level evidence only. No backport edit required.

---

## Precise Test Targets for Phase 1

These are the exact behaviors a test must assert. `/10x-plan` should treat this as the test spec baseline.

### Unit tests for `generateCards()` (mock `fetch` at HTTP edge)

| # | Scenario | Mock response | Expected behavior |
|---|----------|--------------|-------------------|
| U1 | Network failure | `fetch` throws | `GenerationError` thrown; message `"Failed to reach OpenRouter"` |
| U2 | OpenRouter non-OK (e.g. 401) | `{ ok: false, status: 401, text: () => '{"error":"Invalid API key"}' }` | `GenerationError` thrown; message contains `"OpenRouter returned 401"`; raw body NOT propagated to API response (test at API layer, see I1) |
| U3 | Malformed envelope JSON | `{ ok: true, json: () => throws }` | `GenerationError("Failed to parse OpenRouter response as JSON")` |
| U4 | Missing `choices` | `{ ok: true, json: () => { choices: [] } }` | `GenerationError("OpenRouter response missing choices[0].message.content")` |
| U5 | Non-JSON `content` | `content = "Sure! Here are your cards: ..."` | `GenerationError("Model returned non-JSON content")` |
| U6 | Wrong schema — no `cards` key | `content = '{"flashcards": []}'` | `GenerationError("Model response failed schema validation")` |
| U7 | Wrong schema — empty array | `content = '{"cards": []}'` | `GenerationError("Model response failed schema validation")` |
| U8 | Whitespace-only `front` | `content = '{"cards":[{"front":" ","back":"x"}]}'` | **Currently passes** (gap — document for fix in plan) |
| U9 | Fewer cards than requested | `content = '{"cards":[{"front":"Q","back":"A"}]}'`, count=5 | **Currently passes** with 1 card returned (gap — document for fix) |
| U10 | Happy path — exact count | Valid content with N cards | Returns `CardCandidate[]` of length N |
| U11 | More cards than requested | Valid content with N+3 cards, count=N | Returns exactly N cards (`slice` works) |

### Integration test for API route (mock `generateCards`)

| # | Scenario | Mock | Expected HTTP response |
|---|----------|------|----------------------|
| I1 | `GenerationError` with provider body in message | `generateCards` throws `GenerationError("OpenRouter returned 401: {\"error\":...}")` | 502; `error` field does NOT contain `"OpenRouter returned"` or provider JSON (once fix lands) |
| I2 | Unexpected error | `generateCards` throws `new Error("oops")` | 500; `error === "Unexpected error during generation"` |
| I3 | `sourceText` too short | `sourceText = "x"` | 400; validation message |
| I4 | `sourceText` too long | `sourceText = "x".repeat(10_001)` | 400; validation message |
| I5 | Invalid `count` | `count = 7` | 400 |
| I6 | Happy path | Mock returns 5 valid `CardCandidate[]` | 200; `cards` length 5; `generationId` present |

**Anti-pattern to avoid (confirmed critical):** Do NOT assert the exact error message text from `GenerationError` in I1 — that mirrors the implementation bug. Assert instead that the 502 body does not contain raw provider JSON, and that it starts with a safe prefix the team controls (e.g., `"Generation failed"` is fine; embedding `"OpenRouter returned 401"` in the 502 body is the bug).

---

## Open Questions

1. **Should `min(count)` be added to `ResponseSchema`?** The plan says to prove protection, not prescribe the fix. `/10x-plan` should decide: add `min(count)` dynamically, or add a post-validation count assertion, or emit a warning only. The research confirms the gap is real.
2. **Should whitespace trimming happen in `CardSchema` (`.trim().min(1)`) or in the API route's persist step?** Either location works; the plan should pick one and the test should assert from the user/behavior side (whitespace-only cards do not appear in the deck).
3. **Should the 502 error message be a fixed generic string, or a safe-prefix format?** The `lessons.md` rule is `TODO`. The plan should propose the fix; the integration test (I1) asserts the outcome.
4. **Frontend null-guard**: is fixing `!== null` to `!= null` (or adding runtime validation of `GenerateResponseDTO`) in scope for Phase 1, or deferred to Phase 2? The gap is real but only reachable via a 200 response with wrong shape — unlikely in production but easy to unit-test.
