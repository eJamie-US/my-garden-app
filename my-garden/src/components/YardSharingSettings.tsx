// src/components/YardSharingSettings.tsx
// Who has access to one shared yard. Owners can invite by email (the
// invited person needs an account already — there's no "get user by
// email" API, only listUsers()+filter, same constraint GrantAccessModal
// already lives with) and remove anyone but themselves; everyone else just
// sees who they're gardening with and can leave.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2, LogOut, Mail, UserMinus, X } from 'lucide-react';
import { yardMembersService } from '../services/supabase/yardMembers';
import type { Yard, YardMember, YardRole } from '../types';

function roleLabel(t: TFunction, role: YardRole): string {
  return t(`yardSharing.role${role === 'owner' ? 'Owner' : 'Editor'}`);
}

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
  const { t } = useTranslation();
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
      setLoadError(err instanceof Error ? err.message : t('yardSharing.couldNotLoadAccess'));
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
      setError(err instanceof Error ? err.message : t('yardSharing.couldNotSendInvite'));
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
      setError(err instanceof Error ? err.message : t('yardSharing.couldNotRemove'));
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
      setError(err instanceof Error ? err.message : t('yardSharing.couldNotLeaveYard'));
      setBusyUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">{t('yardSharing.sharedWith', { name: yard.name })}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label={t('yardSharing.closeAria')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            {isOwner ? t('yardSharing.ownerDescription') : t('yardSharing.memberDescription')}
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
                        {label} {isMe && <span className="font-normal text-gray-400">{t('yardSharing.you')}</span>}
                      </p>
                      <p className="text-xs text-gray-500">{roleLabel(t, member.role)}</p>
                    </div>
                    {isOwner && !isMe && (
                      <button
                        type="button"
                        onClick={() => remove(member)}
                        disabled={busy}
                        aria-label={t('yardSharing.removeAria', { name: label })}
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
                {t('yardSharing.inviteByEmail')}
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  placeholder={t('yardSharing.emailPlaceholder')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={invite}
                  disabled={inviting || !email.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
                >
                  {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  {t('yardSharing.invite')}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {t('yardSharing.inviteHint')}
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
              {t('yardSharing.leaveYard')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
