-- 022_yard_members_self_owner_insert.sql
-- 020 deliberately gave `authenticated` no INSERT grant on yard_members at
-- all — invites need service-role either way, to resolve an email to a
-- user_id. But creating a brand-new yard is different: the client needs to
-- insert its own owner row right after `yards.insert`, with nothing to
-- resolve, so this grants exactly that one narrow case.
--
-- The obvious policy — WITH CHECK using an EXISTS subquery against
-- `yards.user_id` — doesn't actually work: that subquery runs as the
-- caller's own restricted role, so it's subject to yards' OWN SELECT
-- policy (020, "Members can view their yards" — requires an existing
-- yard_members row). At the exact moment of inserting that FIRST owner
-- row, no such row exists yet — the yard would look invisible to its own
-- creator from inside this check, even though yards.user_id = auth.uid()
-- is true at the raw data level. A SECURITY DEFINER function sidesteps
-- this the standard way: it runs with the function owner's privileges,
-- not the caller's, so it can read yards.user_id directly without being
-- filtered by yards' RLS — while still only ever answering this one
-- narrow question, not exposing broader access.

BEGIN;

CREATE OR REPLACE FUNCTION is_yard_creator(check_yard_id UUID, check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM yards WHERE id = check_yard_id AND user_id = check_user_id);
$$;

GRANT INSERT ON yard_members TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Creator can claim owner membership on their own yard" ON yard_members
    FOR INSERT WITH CHECK (
      auth.uid() = user_id
      AND role = 'owner'
      AND is_yard_creator(yard_id, auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
