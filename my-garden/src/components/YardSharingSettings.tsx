// src/components/YardSharingSettings.tsx
// Who has access to one shared yard. Owners can invite by email (the
// invited person needs an account already — there's no "get user by
// email" API, only listUsers()+filter, same constraint GrantAccessModal
// already lives with) and remove anyone but themselves; everyone else just
// sees who they're gardening with and can leave.

import { useEffect, useState } from 'react';
import { Loader2, LogOut, Mail, UserMinus, X } from 'lucide-react';
import { yardMembersService } from '../services/supabase/yardMembers';
import type { Yard, YardMember } from '../types';

interface YardSharingSettingsProps {
  yard: Yard;
  userId: string;
  isOwner: boolean;
  onClose: () => void;
  /** Fired after the current user leaves this yard — the caller should
   *  drop it from their own yard list. */
  onLeft: () => void;
}

export function YardSharingSettings({ yard, userId, isOwner, onClose, onLeft }: YardSharingSettingsProps) {
  const [members, setMembers] = useState<YardMember[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      setMembers(await yardMembersService.list(yard.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load who has access');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yard.id]);

  const invite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setError('');
    try {
      await yardMembersService.invite(yard.id, trimmed);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invite');
    } finally {
      setInviting(false);
    }
  };

  const remove = async (member: YardMember) => {
    setBusyUserId(member.userId);
    setError('');
    try {
      await yardMembersService.remove(yard.id, member.userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove them');
      setBusyUserId(null);
    }
  };

  const leave = async () => {
    setBusyUserId(userId);
    setError('');
    try {
      await yardMembersService.remove(yard.id, userId);
      onLeft();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave that yard');
      setBusyUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Shared with — {yard.name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close sharing settings"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            {isOwner
              ? 'Anyone you add can view and manage every plant and obstacle in this yard, just like you — perfect for a spouse, roommate, or anyone else tending it with you.'
              : 'Everyone below can view and manage this yard.'}
          </p>

          {(error || loadError) && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error || loadError}
            </div>
          )}

          {members === null ? (
            <div className="flex justify-center py-6 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <ul className="divide-y rounded-lg border border-gray-200">
              {members.map((member) => {
                const isMe = member.userId === userId;
                const label = member.displayName || member.email;
                const initial = label.trim().charAt(0).toUpperCase() || '?';
                const busy = busyUserId === member.userId;
                return (
                  <li key={member.userId} className="flex items-center gap-3 p-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">
                      {member.avatarIcon || initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {label} {isMe && <span className="font-normal text-gray-400">(you)</span>}
                      </p>
                      <p className="text-xs capitalize text-gray-500">{member.role}</p>
                    </div>
                    {isOwner && !isMe && (
                      <button
                        type="button"
                        onClick={() => remove(member)}
                        disabled={busy}
                        aria-label={`Remove ${label}`}
                        className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {isOwner && (
            <div>
              <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-gray-700">
                Invite by email
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  placeholder="them@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={invite}
                  disabled={inviting || !email.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
                >
                  {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  Invite
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                They'll need a My Garden account already — invite by the email they signed up with.
              </p>
            </div>
          )}

          {!isOwner && (
            <button
              type="button"
              onClick={leave}
              disabled={busyUserId === userId}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
            >
              {busyUserId === userId ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              Leave this yard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
