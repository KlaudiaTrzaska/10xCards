---
project: "10xCards"
version: 1
status: draft
created: 2026-06-05
updated: 2026-06-13
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Profesjonaliści uczący się materiału do pracy lub certyfikacji tracą czas na ręczne tworzenie fiszek po każdym rozdziale lub module kursu. 10xCards skraca potok: wklej tekst → AI generuje kandydatów na karty → użytkownik selekcjonuje (akceptuje/edytuje/odrzuca) → talia → sesja nauki. Centralną hipotezą jest, że AI produkuje karty wystarczającej jakości, żeby użytkownik był przede wszystkim kuratorem, nie autorem od zera — i że ten pipeline jest wystarczająco szybki, żeby zmienić przyzwyczajenie „pomijam powtórki, bo ręczne tworzenie kart trwa za długo".

## North star

**S-01 → S-02 → S-04: pełny loop US-01 — gated route → generacja AI → drafty → akceptacja i zapis → sesja nauki → pierwsza ocena review.**

> Gwiazda przewodnia — najmniejszy end-to-end przepływ, którego ukończenie udowadnia centralną hipotezę produktu (na tym opiera się cały projekt; wszystko inne ma znaczenie tylko, jeśli ten loop działa) — to pełne przejście od wklejonego tekstu do pierwszej oceny karty w sesji nauki.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | `gate-product-routes` | (foundation) produktowe ścieżki są chronione logowaniem | — | FR-001, FR-002 | ready |
| F-02 | `first-prod-deploy` | (foundation) pierwszy deployment produkcyjny jest gotowy | — | NFR | ready |
| S-01 | `first-gated-generation` | wkleić tekst źródłowy i zobaczyć wygenerowane drafty kart zapisane po stronie serwera | F-01 | FR-003, FR-004, US-01 | proposed |
| S-02 | `atomic-save-to-deck` | ocenić każdego kandydata (accept/edit/discard) i zapisać zaakceptowane karty atomowo do talii | S-01 | FR-005, US-01 | proposed |
| S-03 | `deck-edit-delete` | przeglądać talię, ręcznie stworzyć fiszkę, edytować i usuwać karty | S-02 | FR-006, FR-007 | proposed |
| S-04 | `srs-review-session` | rozpocząć sesję nauki, zobaczyć zaplanowane karty i zapisać ocenę każdej powtórki | S-02 | FR-008, FR-009, US-01 | blocked |
| S-05 | `account-deletion-with-retention` | usunąć konto z 30-dniowym okresem retencji danych przed trwałym usunięciem | F-01 | FR-001, FR-002 | done |

## Baseline

What's already in place in the codebase as of `2026-06-05` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 + shadcn/ui; strony w `src/pages/`, komponenty w `src/components/ui/`
- **Backend / API:** partial — Astro SSR API routes istnieją (`src/pages/api/auth/*.ts`), wyłącznie auth; brak tras dla kart, AI, sesji nauki
- **Data:** partial — klient Supabase skonfigurowany (`src/lib/supabase.ts`); brak migracji/schematu DB; `supabase/config.toml` obecny
- **Auth:** present — Supabase Auth, cookie-based SSR sessions, middleware chroni `/dashboard` (`src/middleware.ts:6-24`); FR-001 i FR-002 zaimplementowane
- **Deploy / infra:** partial — `wrangler.jsonc` + `@astrojs/cloudflare` skonfigurowane; CI = lint + build (brak kroku deploy)
- **Observability:** partial — `"observability": {"enabled": true}` w `wrangler.jsonc` (Cloudflare dashboard); brak logowania po stronie aplikacji

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
- **Status:** ready

### F-02: First production deploy

- **Outcome:** (foundation) pierwszy deployment produkcyjny na Cloudflare Workers jest gotowy; krok deploy dodany do CI; Workers Secrets ustawione; każdy kolejny slice może być shipowany automatycznie.
- **Change ID:** `first-prod-deploy`
- **PRD refs:** NFR (SR must not lose or corrupt review history — wymaga stabilnego środowiska produkcyjnego)
- **Unlocks:** weryfikacja każdego slice'a w produkcji; production parity dla debugowania Workers runtime issues
- **Prerequisites:** — (`wrangler.jsonc` i `@astrojs/cloudflare` skonfigurowane w baseline)
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - `SUPABASE_URL` i `SUPABASE_KEY` muszą być ustawione jako Workers Secrets przed pierwszym deployem — Owner: user. Block: no (szybka operacja CLI).
- **Risk:** CI do tej pory nie ma kroku deploy — `infrastructure.md` §Getting Started opisuje kroki (`wrangler secret put`, `wrangler deploy`); pominięcie tego na początku powoduje, że każdy slice jest weryfikowany tylko lokalnie, co ukrywa Workers runtime issues (np. incompatible dependencies)
- **Status:** ready

## Slices

### S-01: First gated generation

- **Outcome:** user może wkleić tekst źródłowy i zobaczyć wygenerowane drafty kart zapisane po stronie serwera (widoczne w dalszym kroku curation)
- **Change ID:** `first-gated-generation`
- **PRD refs:** FR-003, FR-004, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - Który model AI przez OpenRouter? (sugerowany w `context/foundation/infrastructure.md` pre-mortem) — Owner: user. Block: no.
  - Format odpowiedzi AI → struktura draftu karty (front/back JSON) — Owner: user. Block: no (do ustalenia w `/10x-plan`).
  - Schemat tabeli `cards` (pola draftu: `id`, `user_id`, `front`, `back`, `status` [`draft`|`accepted`], `generation_source`, `created_at`) — Owner: user. Block: no (decyzja w `/10x-plan`).
- **Risk:** Latencja AI (OpenRouter: ~3-8s per call per `infrastructure.md`) wpływa na UX; Workers CPU limit nie jest problemem (I/O nie liczy się do CPU), ale timeout handling i feedback ładowania są krytyczne; nowa zmienna środowiskowa `OPENROUTER_API_KEY` wymaga `wrangler secret put`
- **Status:** proposed

### S-02: Atomic save to deck

- **Outcome:** user może ocenić każdego kandydata (accept / edit / discard) i zaakceptowane karty są zapisane atomowo do talii w jednej operacji
- **Change ID:** `atomic-save-to-deck`
- **PRD refs:** FR-005, US-01
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Atomowość zapisu: jednen INSERT wielu kart vs sekwencja — Owner: user. Block: no (do ustalenia w `/10x-plan`).
- **Risk:** Częściowy zapis (np. 3 z 5 kart zapisane przy błędzie sieci) łamie spójność talii; implementacja musi być transakcyjna lub idempotentna
- **Status:** proposed

### S-03: Deck edit and delete

- **Outcome:** user może przeglądać całą swoją talię, ręcznie stworzyć fiszkę, edytować i usuwać karty (blokada edycji po pierwszej sesji nauki per FR-007)
- **Change ID:** `deck-edit-delete`
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Reguła blokady (FR-007: „edit/delete allowed until first study review; locked afterward") — blokada w UI, API, czy obie warstwy? Owner: user. Block: no (do ustalenia w `/10x-plan`).
- **Risk:** Reguła blokady wymaga śledzenia `first_reviewed_at` per karta; pole musi być w schemacie z S-01 — jeśli zostanie pominięte, konieczna dodatkowa migracja
- **Status:** proposed

### S-04: SRS review session

- **Outcome:** user może rozpocząć sesję nauki, zobaczyć karty zaplanowane przez algorytm SR, ocenić każdą (again / hard / good / easy) i mieć zaktualizowany harmonogram powtórek bez utraty historii
- **Change ID:** `srs-review-session`
- **PRD refs:** FR-008, FR-009, US-01
- **Prerequisites:** S-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Która biblioteka SR (pure-JS, Workers-compatible)? Kandydat: `ts-fsrs` (FSRS, TypeScript, brak zależności Node.js). `context/foundation/infrastructure.md` ostrzega: biblioteki SR muszą być zweryfikowane pod kątem zgodności z Workers runtime (`child_process` failuje silently). Schemat tabeli `review_logs` zależy od wybranego algorytmu (FSRS vs SM-2 mają różne pola schedulingowe). Owner: user. Block: yes.
- **Risk:** NFR guardrail — „SR must not lose or corrupt review history"; błędna decyzja o algorytmie lub schemacie `review_logs` → utrata historii przy migracji; najdroższy błąd w projekcie — konieczne rozstrzygnięcie SR library choice przed `/10x-plan`
- **Status:** blocked

### S-05: Account deletion with retention

- **Outcome:** user może usunąć konto z 30-dniowym okresem retencji danych przed trwałym usunięciem; dane są nieodwracalnie usuwane po upływie okresu
- **Change ID:** `account-deletion-with-retention`
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Mechanizm soft-delete (pole `deleted_at` + scheduled job) vs Supabase scheduled function — Owner: user. Block: no (do ustalenia w `/10x-plan`).
- **Risk:** Cloudflare Workers nie ma natywnego job schedulera (brak cron bez dodatkowej konfiguracji `wrangler.jsonc`); trwałe usunięcie po 30 dniach wymaga osobnego mechanizmu (Supabase Edge Functions cron lub Workers Cron Trigger)
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | `gate-product-routes` | Extend auth middleware to gate all product routes | yes | Run `/10x-plan gate-product-routes` |
| F-02 | `first-prod-deploy` | Set up CI deploy step and Workers Secrets | yes | Run `/10x-plan first-prod-deploy`; parallel with F-01 |
| S-01 | `first-gated-generation` | AI card generation behind auth gate | no | Depends on F-01 |
| S-02 | `atomic-save-to-deck` | Curation flow with atomic save to deck | no | Depends on S-01 |
| S-03 | `deck-edit-delete` | Deck browsing, manual create, edit and delete | no | Depends on S-02; parallel with S-04 |
| S-04 | `srs-review-session` | Study session with SR algorithm and review outcomes | no | Blocked: SR library choice needed first (Open Roadmap Q #1) |
| S-05 | `account-deletion-with-retention` | Account deletion with 30-day data retention | no | Depends on F-01; parallel with S-01 |

## Open Roadmap Questions

1. **Która biblioteka SR (algorytm + implementacja JS) — `ts-fsrs` (FSRS) czy inna?** Musi być pure-JS i zweryfikowana jako Workers-compatible. Owner: user. Block: S-04 (schemat `review_logs` i pola harmonogramowania zależą od wybranego algorytmu).
2. **Mechanizm trwałego usunięcia konta po 30 dniach** — Workers Cron Trigger w `wrangler.jsonc` vs Supabase Edge Functions cron? Owner: user. Block: S-05 (wybór wpływa na architekturę soft-delete).
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

- **S-05: user może usunąć konto z 30-dniowym okresem retencji danych przed trwałym usunięciem; dane są nieodwracalnie usuwane po upływie okresu** — Archived 2026-06-13 → `context/archive/2026-06-10-account-deletion-with-retention/`. Lesson: —.
