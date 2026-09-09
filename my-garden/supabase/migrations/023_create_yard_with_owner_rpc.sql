-- 023_create_yard_with_owner_rpc.sql
-- Confirmed live: inserting a yard as a plain client (auth.uid() = user_id,
-- satisfies 020's INSERT policy fine) still 403s under
-- supabase-js's default `.insert().select()` — PostgREST's RETURNING
-- clause does its own SELECT-back through yards' policy, which now
-- requires an existing yard_members row that can't exist yet (the classic
-- RLS chicken-and-egg 022 also ran into, one step later in the same flow).
--
-- Doing "insert yards, then insert yard_members" as two separate
-- client-side requests has the same problem in a second form: a network
-- hiccup between the two leaves an ownerless, inaccessible yard behind. A
-- SECURITY DEFINER function sidesteps both — it does both inserts itself,
-- bypassing the caller's RLS state entirely, in one implicitly-transactional
-- call: either both rows exist or neither does.

BEGIN;

CREATE OR REPLACE FUNCTION create_yard_with_owner(
  p_name TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL,
  p_label TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_orientation_deg DOUBLE PRECISION DEFAULT NULL
)
RETURNS yards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_yard yards;
BEGIN
  INSERT INTO yards (user_id, name, image_url, label, latitude, longitude, orientation_deg)
  VALUES (
    auth.uid(),
    COALESCE(NULLIF(TRIM(p_name), ''), 'My Garden'),
    COALESCE(p_image_url, '/default-yard.png'),
    p_label,
    p_latitude,
    p_longitude,
    COALESCE(p_orientation_deg, 0)
  )
  RETURNING * INTO new_yard;

  INSERT INTO yard_members (yard_id, user_id, role) VALUES (new_yard.id, auth.uid(), 'owner');

  RETURN new_yard;
END;
$$;

GRANT EXECUTE ON FUNCTION create_yard_with_owner TO authenticated;

COMMIT;
