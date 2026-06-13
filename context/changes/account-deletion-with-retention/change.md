---
change_id: account-deletion-with-retention
title: Account deletion with 30-day data retention
status: implemented
created: 2026-06-10
updated: 2026-06-13
archived_at: null
---

## Notes

User can delete their account; data is soft-deleted with a `deleted_at` timestamp and permanently purged after 30 days. Requires a scheduled deletion mechanism — either Cloudflare Workers Cron Trigger (wrangler.jsonc) or Supabase Edge Functions cron (open roadmap question #2). Depends on F-01 (`gate-product-routes`); can run in parallel with S-01. PRD refs: FR-001, FR-002.
