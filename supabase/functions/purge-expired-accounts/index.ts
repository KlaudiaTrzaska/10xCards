// Purge accounts whose 30-day retention window has expired.
//
// Invoked daily via pg_cron (see migration 20260610400000_schedule_purge_accounts.sql)
// or manually: npx supabase functions invoke purge-expired-accounts --no-verify-jwt
//
// Supabase auto-injects these into every Edge Function runtime (do NOT set via secrets):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Invoke manually:
//   curl -X POST https://<ref>.supabase.co/functions/v1/purge-expired-accounts \
//     -H "Authorization: Bearer <service_role_key>" \
//     -H "apikey: <service_role_key>" \
//     -d '{}'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing required environment variables" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all profiles past the 30-day retention window
  const { data: expired, error: queryError } = await supabase
    .from("profiles")
    .select("id")
    .not("deleted_at", "is", null)
    .lte("deleted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (queryError) {
    console.error("Failed to query expired accounts:", queryError.message);
    return new Response(JSON.stringify({ error: "Query failed", detail: queryError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!expired || expired.length === 0) {
    return new Response(JSON.stringify({ purged: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let purged = 0;
  const failures: string[] = [];

  for (const row of expired) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(row.id);
    if (deleteError) {
      console.error(`Failed to delete user ${row.id}:`, deleteError.message);
      failures.push(row.id);
    } else {
      purged++;
    }
  }

  const status = failures.length > 0 ? 207 : 200;
  return new Response(
    JSON.stringify({
      purged,
      ...(failures.length > 0 && { failed: failures.length, failed_ids: failures }),
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
});
