// supabase/functions/yard-members/index.ts
// List, invite, and remove members of a shared yard. One function, an
// `action` field picks the operation — mirrors grant-access's shape
// (requireUser, a service-role client, admin.auth.admin.listUsers() +
// filter-by-email since there's no direct "get user by email" call) but
// self-service for any yard's own owner, not gated to a single fixed email.
//
// Every action needs the service-role key regardless of what it's doing:
// resolving an invited email to a user_id only works via the admin API,
// and reading another member's display name means reading past
// user_settings' own (deliberately) own-row-only RLS.
//
// Deploy: supabase functions deploy yard-members
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const caller = await requireUser(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const { action, yardId } = body;
    if (typeof yardId !== 'string' || !yardId) {
      return new Response(JSON.stringify({ error: 'yardId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Every action needs the caller to actually be a member of this yard —
    // check once, up front, via service-role (bypassing yard_members' own
    // client-facing RLS, which only lets someone read their own row).
    const { data: callerMembership, error: membershipError } = await admin
      .from('yard_members')
      .select('role')
      .eq('yard_id', yardId)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!callerMembership) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerIsOwner = callerMembership.role === 'owner';

    if (action === 'list') {
      const { data: members, error: membersError } = await admin
        .from('yard_members')
        .select('user_id, role, created_at')
        .eq('yard_id', yardId)
        .order('created_at', { ascending: true });
      if (membersError) throw membersError;

      const userIds = (members ?? []).map((m) => m.user_id);
      const { data: settingsRows } = await admin
        .from('user_settings')
        .select('user_id, display_name, avatar_icon')
        .in('user_id', userIds);
      const settingsById = new Map((settingsRows ?? []).map((s) => [s.user_id, s]));

      // No admin.getUserById in bulk — listUsers + filter, same constraint
      // as the email lookup below.
      const { data: userList, error: listError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) throw listError;
      const usersById = new Map(userList.users.map((u) => [u.id, u]));

      const result = (members ?? []).map((m) => ({
        userId: m.user_id,
        role: m.role,
        email: usersById.get(m.user_id)?.email ?? '',
        displayName: settingsById.get(m.user_id)?.display_name ?? undefined,
        avatarIcon: settingsById.get(m.user_id)?.avatar_icon ?? undefined,
      }));

      return new Response(JSON.stringify({ members: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invite') {
      if (!callerIsOwner) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { email } = body;
      if (typeof email !== 'string' || !email.trim()) {
        return new Response(JSON.stringify({ error: 'email required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: userList, error: listError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) throw listError;
      const target = userList.users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
      if (!target) {
        return new Response(JSON.stringify({ error: 'user_not_found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: upsertError } = await admin
        .from('yard_members')
        .upsert({ yard_id: yardId, user_id: target.id, role: 'editor' }, { onConflict: 'yard_id,user_id' });
      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({ ok: true, email: target.email }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'remove') {
      const { userId } = body;
      if (typeof userId !== 'string' || !userId) {
        return new Response(JSON.stringify({ error: 'userId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Leaving yourself is always allowed; removing someone else needs owner.
      if (userId !== caller.id && !callerIsOwner) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // An owner can't remove their own last-owner row this way — that
      // would leave the yard ownerless. (Removing yourself as owner when
      // you're the only member is fine; it's covered by the yard's own
      // cascade if you delete the yard instead.)
      if (userId === caller.id && callerIsOwner) {
        const { count } = await admin
          .from('yard_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('yard_id', yardId)
          .eq('role', 'owner');
        if ((count ?? 0) <= 1) {
          return new Response(JSON.stringify({ error: 'sole_owner' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { error: deleteError } = await admin
        .from('yard_members')
        .delete()
        .eq('yard_id', yardId)
        .eq('user_id', userId);
      if (deleteError) throw deleteError;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('yard-members error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
