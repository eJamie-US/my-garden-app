// supabase/functions/_shared/authUser.ts
// Shared "require a real signed-in user" check. The anon key alone
// satisfies Supabase's default JWT verification, so without this any
// visitor holding the (public, bundled-in-the-client) anon key could call
// a function meant to be gated on a real account.
import { createClient, type User } from 'jsr:@supabase/supabase-js@2';

export async function requireUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );
  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
