-- 027_notify_new_signup.sql
-- Fires notify-new-signup (push + optional SMS to the app owner) whenever
-- a new account is created, so granting lifetime access can stay a manual
-- "Grant access" click instead of needing to notice a new row appear.
--
-- SECURITY DEFINER (owned by postgres) because the trigger runs in the
-- context of whatever inserts into auth.users — Supabase Auth's own
-- internal role — which has no reason to be able to read vault secrets or
-- call net.http_post on its own; running as the function owner instead is
-- the standard pattern for auth.users triggers in Supabase.
--
-- Reuses the same 'cron_secret' Vault entry and X-Cron-Secret header
-- send-due-notifications already authenticates with (017) — this is just
-- another "a call that genuinely came from our own Postgres instance"
-- check, not something that needs its own separate secret.

BEGIN;

CREATE OR REPLACE FUNCTION notify_new_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ptjnzvvgnadbpxscwhkv.supabase.co/functions/v1/notify-new-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := jsonb_build_object('email', NEW.email)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_notify ON auth.users;
CREATE TRIGGER on_auth_user_created_notify
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION notify_new_signup();

COMMIT;
