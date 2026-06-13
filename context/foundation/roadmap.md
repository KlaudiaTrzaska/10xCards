---
project: "10xCards"
version: 1
status: draft
created: 2026-06-05
updated: 2026-06-13
prd_version: 1
main_goal: speed
top_blocker: production-hardening
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Profesjonaliści uczący się materiału do pracy lub certyfikacji tracą czas na ręczne tworzenie fiszek po każdym rozdziale lub module kursu. 10xCards skraca potok: wklej tekst → AI generuje kandydatów na karty → użytkownik selekcjonuje (akceptuje/edytuje/odrzuca) → talia → sesja nauki. Centralną hipotezą jest, że AI produkuje karty wystarczającej jakości, żeby użytkownik był przede wszystkim kuratorem, nie autorem od zera — i że ten pipeline jest wystarczająco szybki, żeby zmienić przyzwyczajenie „pomijam powtórki, bo ręczne tworzenie kart trwa za długo".

## North star

**✅ US-01 loop shipped (2026-06-10).** Pełny przepływ od wklejonego tekstu do pierwszej oceny karty w sesji nauki jest zaimplementowany: F-01 → S-01 → S-02 → S-04 (+ S-03 deck CRUD, S-05 account deletion).

**Next focus:** walidacja metryk sukcesu z PRD (≥75% akceptacji draftów, ≥75% kart z AI, median paste→accept <5 min) oraz domknięcie produkcji (custom domain, monitoring, rollback — patrz `context/changes/deployment/deployment-plan.md` fazy 5–10).

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | `gate-product-routes` | (foundation) produktowe ścieżki są chronione logowaniem | — | FR-001, FR-002 | done |
| F-02 | `first-prod-deploy` | (foundation) pierwszy deployment produkcyjny jest gotowy | — | NFR | done |
| S-01 | `first-gated-generation` | wkleić tekst źródłowy i zobaczyć wygenerowane drafty kart zapisane po stronie serwera | F-01 | FR-003, FR-004, US-01 | done |
| S-02 | `atomic-save-to-deck` | ocenić każdego kandydata (accept/edit/discard) i zapisać zaakceptowane karty atomowo do talii | S-01 | FR-005, US-01 | done |
| S-03 | `deck-edit-delete` | przeglądać talię, ręcznie stworzyć fiszkę, edytować i usuwać karty | S-02 | FR-006, FR-007 | done |
| S-04 | `srs-review-session` | rozpocząć sesję nauki, zobaczyć zaplanowane karty i zapisać ocenę każdej powtórki | S-02 | FR-008, FR-009, US-01 | done |
| S-05 | `account-deletion-with-retention` | usunąć konto z 30-dniowym okresem retencji danych przed trwałym usunięciem | F-01 | FR-001, FR-002 | done |

## Baseline

What's already in place in the codebase as of `2026-06-13` (auto-researched from git history + codebase).

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 + shadcn/ui; strony produktowe: `/home`, `/generate`, `/deck`, `/study`, `/settings`; komponenty w `src/components/`
- **Backend / API:** present — auth (`src/pages/api/auth/*.ts`), generacja (`/api/generate`), kuracja (`/api/save-deck`), talia CRUD (`/api/deck`, `/api/deck/[id]`), sesja nauki (`/api/study/due`, `/api/study/review`), usunięcie konta (`/api/account/delete`)
- **Data:** present — 7 migracji Supabase (`flashcards`, `generations`, `review_logs`, `profiles`, FSRS columns, soft-delete, purge cron); RLS per tabela
- **Auth:** present — Supabase Auth, cookie-based SSR sessions; middleware negatywny (allow-list publicznych tras: `/`, `/auth`, `/api/auth`, `/sitemap`); `returnTo` w flow logowania
- **AI generation:** present — OpenRouter (`openai/gpt-4o-mini`) via `src/lib/services/generation.ts`; `OPENROUTER_API_KEY` w `astro.config.mjs` env schema
- **SRS:** present — `ts-fsrs` v5.4.1 via `src/lib/services/srs.ts`; oceny Again/Hard/Good/Easy; append-only `review_logs`
- **Deploy / infra:** present — live na Cloudflare Workers (`https://10xcards.bialczyk-klaudia91.workers.dev`); Workers Builds auto-deploy na push do `main`; GitHub Actions CI = lint + build (deploy via Workers Builds, nie krok w CI)
- **Observability:** partial — `"observability": {"enabled": true}` w `wrangler.jsonc`; brak logowania po stronie aplikacji; post-launch monitoring pending (`deployment-plan.md` faza 10)

## Foundations

### F-01: Gate product routes

- **Outcome:** (foundation) wszystkie produktowe ścieżki (generacja, talia, nauka) są chronione logowaniem; middleware rozbudowany o wzorzec obejmujący przyszłe trasy produktowe, nie tylko `/dashboard`.
- **Change ID:** `gate-product-routes`
- **PRD refs:** FR-001 (rejestracja wymaga per-user storage), FR-002 (login/logout)
- **Unlocks:** S-01 (generacja dostępna tylko dla zalogowanych), S-02 (zapis do talii wymaga user_id), S-05 (usunięcie konta wymaga identity)
- **Prerequisites:** — (auth middleware obecny w `src/middleware.ts`; rozbudowa, nie nowy komponent)
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Obecny middleware chroni tylko `/dashboard` — każda nowa trasa produktowa musi być jawnie dodana lub middleware musi przejść na wzorzec negatywny (allow-list dla publicznych); błąd tu odsłania dane per-user
- **Status:** done

### F-02: First production deploy

- **Outcome:** (foundation) pierwszy deployment produkcyjny na Cloudflare Workers jest gotowy; krok deploy dodany do CI; Workers Secrets ustawione; każdy kolejny slice może być shipowany automatycznie.
- **Change ID:** `first-prod-deploy`
- **PRD refs:** NFR (SR must not lose or corrupt review history — wymaga stabilnego środowiska produkcyjnego)
- **Unlocks:** weryfikacja każdego slice'a w produkcji; production parity dla debugowania Workers runtime issues
- **Prerequisites:** — (`wrangler.jsonc` i `@astrojs/cloudflare` skonfigurowane w baseline)
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** CI do tej pory nie ma kroku deploy — `infrastructure.md` §Getting Started opisuje kroki (`wrangler secret put`, `wrangler deploy`); pominięcie tego na początku powoduje, że każdy slice jest weryfikowany tylko lokalnie, co ukrywa Workers runtime issues (np. incompatible dependencies)
- **Status:** done — Workers Builds CD aktywny (auto-deploy na push do `main`); live URL potwierdzony 2026-06-05. Pending follow-ups: custom domain, preview security, rollback docs — patrz `context/changes/deployment/deployment-plan.md`.

## Slices

### S-01: First gated generation

- **Outcome:** user może wkleić tekst źródłowy i zobaczyć wygenerowane drafty kart zapisane po stronie serwera (widoczne w dalszym kroku curation)
- **Change ID:** `first-gated-generation` (`s-01`)
- **PRD refs:** FR-003, FR-004, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Latencja AI (OpenRouter: ~3-8s per call per `infrastructure.md`) wpływa na UX; Workers CPU limit nie jest problemem (I/O nie liczy się do CPU), ale timeout handling i feedback ładowania są krytyczne; nowa zmienna środowiskowa `OPENROUTER_API_KEY` wymaga `wrangler secret put`
- **Status:** done — `impl_reviewed` 2026-06-10. `/generate` + `POST /api/generate` + OpenRouter + tabele `generations`/`flashcards`.

### S-02: Atomic save to deck

- **Outcome:** user może ocenić każdego kandydata (accept / edit / discard) i zaakceptowane karty są zapisane atomowo do talii w jednej operacji
- **Change ID:** `atomic-save-to-deck`
- **PRD refs:** FR-005, US-01
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Częściowy zapis (np. 3 z 5 kart zapisane przy błędzie sieci) łamie spójność talii; implementacja musi być transakcyjna lub idempotentna
- **Status:** done — `impl_reviewed` 2026-06-10. Curation UI + `POST /api/save-deck` + success banner na `/home`.

### S-03: Deck edit and delete

- **Outcome:** user może przeglądać całą swoją talię, ręcznie stworzyć fiszkę, edytować i usuwać karty (blokada edycji po pierwszej sesji nauki per FR-007)
- **Change ID:** `deck-edit-delete`
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Reguła blokady wymaga śledzenia `first_reviewed_at` per karta; pole musi być w schemacie z S-01 — jeśli zostanie pominięte, konieczna dodatkowa migracja
- **Status:** done — `implemented` 2026-06-08. `/deck` + CRUD API + `first_reviewed_at` lock aktywowany przy pierwszej ocenie w sesji nauki.

### S-04: SRS review session

- **Outcome:** user może rozpocząć sesję nauki, zobaczyć karty zaplanowane przez algorytm SR, ocenić każdą (again / hard / good / easy) i mieć zaktualizowany harmonogram powtórek bez utraty historii
- **Change ID:** `srs-review-session`
- **PRD refs:** FR-008, FR-009, US-01
- **Prerequisites:** S-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** NFR guardrail — „SR must not lose or corrupt review history"; błędna decyzja o algorytmie lub schemacie `review_logs` → utrata historii przy migracji; najdroższy błąd w projekcie — konieczne rozstrzygnięcie SR library choice przed `/10x-plan`
- **Status:** done — `impl_reviewed` 2026-06-10. `ts-fsrs` (FSRS) + `/study` + `GET /api/study/due` + `POST /api/study/review` + `review_logs`.

### S-05: Account deletion with retention

- **Outcome:** user może usunąć konto z 30-dniowym okresem retencji danych przed trwałym usunięciem; dane są nieodwracalnie usuwane po upływie okresu
- **Change ID:** `account-deletion-with-retention`
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Cloudflare Workers nie ma natywnego job schedulera (brak cron bez dodatkowej konfiguracji `wrangler.jsonc`); trwałe usunięcie po 30 dniach wymaga osobnego mechanizmu (Supabase Edge Functions cron lub Workers Cron Trigger)
- **Status:** done — archived 2026-06-13. Soft-delete via `profiles.deleted_at` + Supabase Edge Function `purge-expired-accounts` (cron 03:00 UTC) + `/settings` UI.

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| — | `deployment` (follow-ups) | Custom domain, preview security, rollback docs | yes | Fazy 5–10 w `context/changes/deployment/deployment-plan.md` |
| — | — | Validate PRD success metrics with real users | no | Wymaga użytkowników produkcyjnych; nie ma dedykowanego change folder |

> Wszystkie slice'y roadmapy (F-01, F-02, S-01–S-05) są zaimplementowane. Kolejne prace to hardening produkcji i walidacja hipotezy produktowej — nie nowe slice'y MVP.

## Open Roadmap Questions

1. ~~**Która biblioteka SR?**~~ **Resolved 2026-06-10:** `ts-fsrs` (FSRS v5.4.1), Workers-compatible, zweryfikowane w `srs-review-session`.
2. ~~**Mechanizm trwałego usunięcia konta po 30 dniach**~~ **Resolved 2026-06-13:** Supabase Edge Function `purge-expired-accounts` + pg_cron (migracja `20260610400000_schedule_purge_accounts.sql`).
3. **target_scale.qps ballpark** — Owner: user. Block: roadmap-wide (prawdopodobnie nieblokujące — tech-stack wybrany pod medium scale).
4. **target_scale.data_volume ballpark** — Owner: user. Block: roadmap-wide (jak wyżej).

## Parked

- **Custom SR engine** — Why parked: PRD §Non-Goals — integracja istniejącego algorytmu zamiast budowy własnego schedulera.
- **Multi-format import (PDF, DOCX, etc.)** — Why parked: PRD §Non-Goals — paste-only entry point for v1.
- **Sharing decks between users** — Why parked: PRD §Non-Goals — single-tenant decks, no collaboration or public deck library.
- **Integrations with educational platforms** — Why parked: PRD §Non-Goals — out of scope for MVP.
- **Native mobile apps** — Why parked: PRD §Non-Goals — web-only for v1.
- **URL/article fetch** — Why parked: PRD §Non-Goals — deferred to v2; paste is the only ingestion path for MVP.
- **On-device LLM generation** — Why parked: PRD §Non-Goals — generation via hosted model path only.
- **Team workspaces / org admin** — Why parked: PRD §Non-Goals — flat single-user accounts only.

## Done

- **F-01: produktowe ścieżki chronione logowaniem** — Implemented 2026-06-05 → `context/changes/gate-product-routes/`. Middleware negatywny (allow-list) + `returnTo` w signin.
- **F-02: pierwszy deployment produkcyjny** — Confirmed 2026-06-05 → `context/changes/deployment/deployment-plan.md`. Workers Builds CD; live URL aktywny.
- **S-01: wklejenie tekstu → drafty kart zapisane po stronie serwera** — Impl reviewed 2026-06-10 → `context/changes/s-01/`. `/generate` + OpenRouter + `generations`/`flashcards`.
- **S-02: kuracja (accept/edit/discard) + atomowy zapis do talii** — Impl reviewed 2026-06-10 → `context/changes/atomic-save-to-deck/`. Curation UI + `POST /api/save-deck`.
- **S-03: przeglądanie talii, ręczne tworzenie, edycja i usuwanie kart** — Implemented 2026-06-08 → `context/changes/deck-edit-delete/`. `/deck` + CRUD API + lock-after-first-review.
- **S-04: sesja nauki z algorytmem SR i zapisem ocen** — Impl reviewed 2026-06-10 → `context/changes/srs-review-session/`. `ts-fsrs` + `/study` + `review_logs`.
- **S-05: usunięcie konta z 30-dniowym okresem retencji** — Archived 2026-06-13 → `context/archive/2026-06-10-account-deletion-with-retention/`. Soft-delete + Edge Function purge cron + `/settings`.
