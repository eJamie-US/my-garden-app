-- 021_yard_members_recursion_fix.sql
-- 020's yard_members SELECT/DELETE policies each queried yard_members from
-- inside their own USING clause (checking "is auth.uid() a member of this
-- row's yard" by re-querying the very table RLS is being evaluated for) —
-- Postgres correctly rejects that as infinite recursion (42P17), and it
-- broke every other table's policies too, since they all check membership
-- by querying yard_members, which was itself unreadable.
--
-- Neither policy actually needs that self-join: the client only ever reads
-- its OWN membership row directly (auth.uid() = user_id) — the full "who
-- else is on this yard" list is served by the yard-members Edge Function
-- via service-role, which bypasses RLS entirely. Same for removing
-- someone else: that's a service-role-only action in the Edge Function,
-- never a direct client DELETE — direct client deletes stay self-only
-- (leaving a yard).

BEGIN;

DROP POLICY IF EXISTS "Members can view a yard's membership" ON yard_members;
CREATE POLICY "Users can view their own membership rows" ON yard_members
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Leave, or an owner removes someone" ON yard_members;
CREATE POLICY "Users can leave a yard" ON yard_members
  FOR DELETE USING (auth.uid() = user_id);

COMMIT;
