// src/components/ProfileSettings.tsx
// Display name + a picked emoji, so the account menu can show something
// friendlier than an email initial. Saved on the same user_settings row as
// garden location.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { userSettingsService, type CareHistoryRetention, type Profile } from '../services/supabase/userSettings';
import { careCompletionsService } from '../services/supabase/careCompletions';
import { SUPPORTED_LOCALES, setAppLanguage } from '../i18n';

const RETENTION_OPTIONS: CareHistoryRetention[] = ['1_day', '1_week', '1_month', '6_months', '1_year', 'forever'];

/** 'forever' doesn't make sense as a manual clear cutoff ("clear history
 *  older than forever" isn't a meaningful instruction) — only the actual
 *  time-bound presets apply here. */
type ClearCutoff = Exclude<CareHistoryRetention, 'forever'>;
const CLEAR_CUTOFF_OPTIONS: ClearCutoff[] = ['1_day', '1_week', '1_month', '6_months', '1_year'];

/** Same preset keys the retention setting and the daily purge job use — see
 *  migration 031's cron job for the server-side equivalent of this switch. */
function cutoffDateFor(preset: ClearCutoff): Date {
  const d = new Date();
  switch (preset) {
    case '1_day': d.setDate(d.getDate() - 1); break;
    case '1_week': d.setDate(d.getDate() - 7); break;
    case '1_month': d.setMonth(d.getMonth() - 1); break;
    case '6_months': d.setMonth(d.getMonth() - 6); break;
    case '1_year': d.setFullYear(d.getFullYear() - 1); break;
  }
  return d;
}

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
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(current.displayName ?? '');
  const [avatarIcon, setAvatarIcon] = useState(current.avatarIcon ?? '');
  const [locale, setLocale] = useState(current.locale ?? 'en');
  const [careHistoryRetention, setCareHistoryRetention] = useState<CareHistoryRetention>(
    current.careHistoryRetention ?? '1_week',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [clearCutoff, setClearCutoff] = useState<ClearCutoff>('1_month');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState('');
  const [cleared, setCleared] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await userSettingsService.saveProfile(userId, {
        displayName: displayName.trim() || undefined,
        avatarIcon: avatarIcon || undefined,
        locale,
        careHistoryRetention,
      });
      setAppLanguage(locale);
      onSaved(saved.profile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profileSettings.saveError'));
      setSaving(false);
    }
  };

  const clearHistory = async () => {
    setClearing(true);
    setClearError('');
    try {
      await careCompletionsService.clearOlderThan(userId, cutoffDateFor(clearCutoff));
      setConfirmingClear(false);
      setCleared(true);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : t('profileSettings.clearHistoryError'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">{t('profileSettings.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label={t('profileSettings.close')}
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
              {t('profileSettings.displayName')}
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('profileSettings.displayNamePlaceholder')}
              maxLength={40}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label htmlFor="language" className="mb-1 block text-xs font-semibold text-gray-600">
              {t('profileSettings.language')}
            </label>
            <select
              id="language"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.nativeName}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="care-history-retention" className="mb-1 block text-xs font-semibold text-gray-600">
              {t('profileSettings.careHistoryRetention')}
            </label>
            <select
              id="care-history-retention"
              value={careHistoryRetention}
              onChange={(e) => setCareHistoryRetention(e.target.value as CareHistoryRetention)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            >
              {RETENTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`profileSettings.retentionOptions.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">{t('profileSettings.clearHistory')}</p>
            {clearError && <p className="mb-2 text-xs text-red-600">{clearError}</p>}
            {cleared && !confirmingClear && (
              <p className="mb-2 text-xs text-emerald-700">{t('profileSettings.clearHistoryDone')}</p>
            )}
            {confirmingClear ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-800">
                  {t('profileSettings.clearHistoryConfirm', { period: t(`profileSettings.retentionOptions.${clearCutoff}`) })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="flex-1 rounded-md border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={clearHistory}
                    disabled={clearing}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-400"
                  >
                    {clearing && <Loader2 size={12} className="animate-spin" />}
                    {t('profileSettings.clearHistoryButton')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={clearCutoff}
                  onChange={(e) => {
                    setClearCutoff(e.target.value as ClearCutoff);
                    setCleared(false);
                  }}
                  aria-label={t('profileSettings.clearHistory')}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {CLEAR_CUTOFF_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`profileSettings.retentionOptions.${option}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {t('profileSettings.clearHistoryButton')}
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-600">{t('profileSettings.icon')}</p>
            <div className="grid grid-cols-8 gap-1.5">
              <button
                type="button"
                onClick={() => setAvatarIcon('')}
                aria-pressed={avatarIcon === ''}
                aria-label={t('profileSettings.noIcon', { initial: fallbackInitial })}
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
                  aria-label={t('profileSettings.useIcon', { icon })}
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
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('profileSettings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
