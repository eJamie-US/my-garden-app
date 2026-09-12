// src/services/supabase/userSettings.ts

import { supabase } from '../../lib/supabase';

export interface Profile {
  displayName?: string;
  /** A single emoji, picked from a small curated set — see ProfileSettings. */
  avatarIcon?: string;
  /** ISO 639-1 code, e.g. 'en', 'es'. Always set (defaults to 'en' at the
   *  DB level) — see src/i18n.ts's SUPPORTED_LOCALES for the current list. */
  locale?: string;
}

export interface UserSettings {
  userId: string;
  /** Which yard the app opens to. Null only if the account somehow has no
   *  yards yet — shouldn't happen once the account has been through the
   *  yards migration/first-run flow. */
  defaultYardId: string | null;
  profile: Profile;
}

interface UserSettingsRow {
  user_id: string;
  default_yard_id: string | null;
  display_name: string | null;
  avatar_icon: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
}

function toSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    defaultYardId: row.default_yard_id,
    profile: {
      displayName: row.display_name ?? undefined,
      avatarIcon: row.avatar_icon ?? undefined,
      locale: row.locale,
    },
  };
}

export const userSettingsService = {
  /** Null when the user has never saved a settings row yet. */
  async getSettings(userId: string): Promise<UserSettings | null> {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return data ? toSettings(data as UserSettingsRow) : null;
  },

  /** Upserts on user_id, since a settings row may not exist yet. Locale is
   *  only written when explicitly provided — omitting it (e.g. when just
   *  changing the display name) leaves the DB's own default/existing value
   *  alone rather than stomping it back to 'en'. */
  async saveProfile(userId: string, profile: Profile): Promise<UserSettings> {
    const patch: Record<string, unknown> = {
      user_id: userId,
      display_name: profile.displayName?.trim() || null,
      avatar_icon: profile.avatarIcon ?? null,
    };
    if (profile.locale !== undefined) patch.locale = profile.locale;

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(patch, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return toSettings(data as UserSettingsRow);
  },

  /** Which yard the app should open to next time. */
  async setDefaultYard(userId: string, yardId: string): Promise<UserSettings> {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: userId, default_yard_id: yardId },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) throw error;
    return toSettings(data as UserSettingsRow);
  },
};
