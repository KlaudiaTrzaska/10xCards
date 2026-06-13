-- Schedule the purge-expired-accounts Edge Function to run daily at 03:00 UTC.
--
-- Prerequisites (run ONCE in the Supabase SQL editor BEFORE applying this migration):
--
--   ALTER DATABASE postgres
--     SET "app.supabase_url" TO 'https://<your-project-ref>.supabase.co';
--
--   ALTER DATABASE postgres
--     SET "app.supabase_service_role_key" TO '<your-service-role-key>';
--
-- Then deploy the Edge Function:
--   npx supabase functions deploy purge-expired-accounts
--
-- Then push this migration:
--   npx supabase db push
--
-- Alternative (no-code): skip this migration and schedule via the Supabase Dashboard →
-- Edge Functions → purge-expired-accounts → Schedule tab → "0 3 * * *".
-- That approach does not require pg_net or app.* database settings.

SELECT cron.schedule(
  'purge-expired-accounts',
  '0 3 * * *',
  format(
    $$
    SELECT net.http_post(
      url        := '%s/functions/v1/purge-expired-accounts',
      headers    := jsonb_build_object(
                      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
                      'Content-Type',  'application/json'
                    ),
      body       := '{}'::jsonb
    );
    $$,
    current_setting('app.supabase_url')
  )
);
