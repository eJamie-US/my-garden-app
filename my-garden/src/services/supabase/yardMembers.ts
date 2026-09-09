// src/services/supabase/yardMembers.ts
// Who has access to a shared yard, and inviting/removing them. All three
// operations go through the yard-members Edge Function rather than a
// direct table query — resolving an invited email to a user_id needs the
// service-role admin API, and listing members needs to read past
// user_settings' own-row-only RLS to show a display name, so there's no
// version of this that works as a plain client-side query anyway.

import type { YardMember, YardRole } from '../../types';
import { supabase } from '../../lib/supabase';

interface MemberResponse {
  userId: string;
  role: YardRole;
  email: string;
  displayName?: string;
  avatarIcon?: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('yard-members', { body });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 403) throw new Error("You don't have permission to do that for this yard.");
    if (status === 404) throw new Error("No account found for that email — they'll need to sign up first.");
    if (status === 409) throw new Error("You're the only owner — add another owner before leaving.");
    throw new Error('Could not reach yard sharing right now.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const yardMembersService = {
  async list(yardId: string): Promise<YardMember[]> {
    const data = await call<{ members: MemberResponse[] }>({ action: 'list', yardId });
    return data.members;
  },

  /** Throws with a message suitable for direct display if the email has no
   *  account yet, or the caller isn't this yard's owner. */
  async invite(yardId: string, email: string): Promise<void> {
    await call({ action: 'invite', yardId, email });
  },

  /** Also used for "leave this yard" — pass the caller's own userId. */
  async remove(yardId: string, userId: string): Promise<void> {
    await call({ action: 'remove', yardId, userId });
  },
};
