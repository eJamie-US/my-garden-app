// src/components/ProfileSettings.tsx
// Display name + a picked emoji, so the account menu can show something
// friendlier than an email initial. Saved on the same user_settings row as
// garden location.

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { userSettingsService, type Profile } from '../services/supabase/userSettings';

const ICON_OPTIONS = [
  '🌱', '🌵', '🌻', '🌷', '🌸', '🌹', '🌿', '🍀',
  '🪴', '🍄', '🌾', '🍃', '🐝', '🦋', '🐌', '🐞',
];

interface ProfileSettingsProps {
  userId: string;
  current: Profile;
  fallbackInitial: string;
  onSaved: (profile: Profile) => void;
  onClose: () => void;
}

export function ProfileSettings({
  userId,
  current,
  fallbackInitial,
  onSaved,
  onClose,
}: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(current.displayName ?? '');
  const [avatarIcon, setAvatarIcon] = useState(current.avatarIcon ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await userSettingsService.saveProfile(userId, {
        displayName: displayName.trim() || undefined,
        avatarIcon: avatarIcon || undefined,
      });
      onSaved(saved.profile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Your profile</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close profile settings"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="display-name" className="mb-1 block text-xs font-semibold text-gray-600">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What should we call you?"
              maxLength={40}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-600">Icon</p>
            <div className="grid grid-cols-8 gap-1.5">
              <button
                type="button"
                onClick={() => setAvatarIcon('')}
                aria-pressed={avatarIcon === ''}
                aria-label={`No icon — use the initial "${fallbackInitial}" instead`}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition ${
                  avatarIcon === ''
                    ? 'bg-emerald-500 text-white ring-2 ring-emerald-600 ring-offset-2'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {fallbackInitial}
              </button>
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setAvatarIcon(icon)}
                  aria-pressed={avatarIcon === icon}
                  aria-label={`Use ${icon} as your icon`}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-lg transition ${
                    avatarIcon === icon
                      ? 'bg-emerald-100 ring-2 ring-emerald-600 ring-offset-2'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
