---
project: "10xCards"
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
created: 2026-05-23
updated: 2026-05-23
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: pain category
      decision: workflow friction — source material to usable flashcards is too slow/heavy
    - topic: insight
      decision: AI drafts cards fast enough that humans primarily curate, not author from blank
    - topic: primary persona
      decision: professional upskiller — solo learner for work-related or certification material
    - topic: auth model
      decision: email + password login; server-side per-user card storage
    - topic: roles
      decision: flat user model — no admin/member separation for MVP
  frs_drafted: 9
  quality_check_status: accepted
---

# Shape notes — 10xCards

Seed: `idea-notes.md` (captured verbatim at session start).

## Vision & Problem Statement

Creating high-quality flashcards by hand is time-consuming. Professionals upskilling on their own often finish a chapter, article, or course module and need cards before their next spaced-repetition session — but the manual authoring step is heavy enough that they skip SR, stay on passive notes, or ship generic low-quality cards.

The insight: AI can draft candidate cards quickly enough that the human's job becomes **curate and refine**, not **write every prompt–answer pair from a blank page**. Competing with "just use Anki manually" means shrinking the source → deck pipeline, not building another flashcard editor alone.

Pain category: **workflow friction** (not missing a single feature in isolation).

## User & Persona

**Primary persona — professional upskiller**

- Role: individual learning work-related or certification material (not a classroom educator building decks for a class).
- Context: self-directed study alongside a job; materials are articles, course modules, internal docs, certification outlines.
- Moment they reach for 10xCards: after consuming source material, before the next SR session, when they need a deck but dread hand-authoring cards.
- What they need from MVP: paste text → AI-generated draft cards → quick edit → store under their account → hand off to an existing repetition algorithm.

## Access Control

- **Sign-up / sign-in:** Email + password. Users create an account to persist flashcards server-side.
- **Roles:** Flat model — every authenticated user has the same capabilities. No admin role for MVP.
- **Gated behavior:** Unauthenticated users cannot create, edit, or review stored cards (browse/marketing landing only, if any).
- **Data boundary:** Each user sees only their own decks/cards.

## Success Criteria

### Primary

- End-to-end MVP flow works: sign up → paste text → AI generates drafts → user accepts/edits/discards → manual CRUD → study session via integrated spaced-repetition (not a custom SM-2 engine).
- ≥ 75% of AI-generated card candidates are accepted (as-is or after minor edit) by the user.
- ≥ 75% of cards in a user's deck are created via the AI generation path (not manual-only creation).

### Secondary

- Median time from paste to first accepted card is under 5 minutes.

### Guardrails

- Integrated spaced-repetition must not lose or corrupt review history (scheduling state remains consistent across sessions).

### MVP flow (reference)

1. Sign up / log in (email + password)
2. Paste source text
3. AI generates draft flashcards
4. Review — accept, edit, or discard each card
5. Optionally create or edit a card manually
6. Browse deck — list, edit, delete
7. Study session via integrated existing repetition algorithm

## Functional Requirements

### Authentication

- FR-001: User can register with email and password. Priority: must-have
  > Socrates: No counter-argument; email+password stands for server-side per-user storage.
- FR-002: User can log in and log out. Priority: must-have
  > Socrates: No counter-argument; explicit logout stands.

### AI generation & curation

- FR-003: User can paste source text as input for card generation. Priority: must-have
  > Socrates: Counter — URL fetch may be the natural entry point. Resolution: paste-only for MVP; URL fetch deferred to v2.
- FR-004: User can generate draft flashcards from pasted text. Priority: must-have
  > Socrates: No counter-argument; generation stands as core value.
- FR-005: User can accept, edit, or discard each AI-generated draft before it enters their deck. Priority: must-have
  > Socrates: No counter-argument; per-card curation stands (supports 75% acceptance metric).

### Deck management

- FR-006: User can manually create a flashcard. Priority: must-have
  > Socrates: No counter-argument; manual path stays for edge cases outside AI.
- FR-007: User can list, edit, and delete their stored flashcards. Priority: must-have
  > Socrates: Counter — editing after review may break SR integrity. Resolution: edit/delete allowed until first study review; locked afterward.

### Study

- FR-008: User can start a study session using integrated spaced repetition. Priority: must-have
  > Socrates: Counter — export-to-Anki avoids integration cost. Resolution: integrated study stays in MVP; export is a non-goal for v1.
- FR-009: User can record a review outcome during study (e.g. again / hard / good / easy or equivalent). Priority: must-have
  > Socrates: Counter — implicit scheduling without grades. Resolution: explicit grades kept; required by integrated SR.

## User Stories

### US-01: Create a deck from pasted material and study

- **Given** a logged-in professional upskiller with source text pasted into the generator
- **When** they request AI generation, accept at least one draft card, and open study
- **Then** accepted cards appear in their deck and a study session presents due cards using the integrated repetition algorithm

#### Acceptance Criteria

- At least one generated card must be explicitly accepted before it is stored
- Study session only includes cards the user has accepted into their deck
- Review outcomes during study update scheduling without losing prior review history

## Business Logic

AI and the spaced-repetition algorithm together determine what the user learns and when.

The user supplies pasted study text. The product produces candidate flashcards from that text; the user accepts or rejects each candidate. Accepted cards enter the user's deck. During study, review outcomes feed the repetition algorithm, which selects the next due material and timing. The user's job is to supply source material and judge card quality; the product decides the learning queue and schedule.

Rule shape: **recommendation** (AI suggests what to learn) combined with **workflow** (draft → accepted → due → reviewed).

## Non-Functional Requirements

- Integrated spaced-repetition must not lose or corrupt review history across sessions (see Guardrails under Success Criteria). No additional NFR targets locked for MVP beyond this.

## Non-Goals

- **Custom spaced-repetition engine** — MVP integrates an existing algorithm; no SuperMemo/Anki-level scheduler build.
- **Multi-format import (PDF, DOCX, etc.)** — paste-only entry point for v1.
- **Sharing decks between users** — single-tenant decks; no collaboration or public deck library.
- **Integrations with other educational platforms** — out of scope for MVP.
- **Native mobile apps** — web-only for v1.
- **URL/article fetch** — deferred to v2; paste is the only ingestion path for MVP.
- **Local/on-device LLM for generation** — generation assumes a hosted model path.
- **Team workspaces / org admin** — flat single-user accounts only.

## Forward: tech-stack

(Informational only — not part of PRD. Populated if user volunteers stack preferences during later steps.)

## Quality cross-check

All elements present at session close (2026-05-23): Access Control, Business Logic (one-sentence rule), timeline ≤ 3 weeks, Non-Goals (8 entries). No gaps accepted under override.
