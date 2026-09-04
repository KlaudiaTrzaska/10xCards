---
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

10xCards is a greenfield web-app for a solo builder on a three-week after-hours timeline with medium user scale, email/password auth, AI-generated flashcards, and integrated spaced repetition added in application code. The recommended default for web in JavaScript/TypeScript is 10x-astro-starter: Astro with React islands, TypeScript, Supabase for auth and Postgres persistence, and Cloudflare Pages as the default deploy target—matching auth (FR-001/002), paste-and-generate AI flow (FR-004), and per-user card storage without building auth or database plumbing from scratch. Cloudflare Pages and GitHub Actions with auto-deploy-on-merge align with the chosen deployment and CI answers. Spaced-repetition scheduling remains a deliberate MVP addition on top of the starter; the PRD non-goal of a custom SM-2 engine is respected by integrating an existing algorithm in-app. Payments, realtime, and background jobs stay out of scope per the PRD.
