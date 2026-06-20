# Change: testing-bootstrap-generation-resilience

| Field | Value |
|-------|-------|
| id | testing-bootstrap-generation-resilience |
| created | 2026-06-20 |
| updated | 2026-06-20 |
| status | implementing |
| type | test-rollout |

## Summary

Rollout Phase 1 of `context/foundation/test-plan.md` — "Bootstrap + generation resilience".

Set up Vitest and prove LLM malformed-response handling (Risk #1) and paste validation (Risk #7).

## Risks covered

- **#1** — LLM provider returns invalid/malformed output and the generation flow crashes or shows garbage instead of draft cards.
- **#7** — Oversized or malicious pasted input causes generation to fail opaquely or exhaust resources.

## Test types

unit + integration
