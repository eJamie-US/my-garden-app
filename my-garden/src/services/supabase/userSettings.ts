// src/services/supabase/userSettings.ts

import { supabase } from '../../lib/supabase';

export interface GardenLocation {
  label?: string;
  latitude: number;
  longitude: number;
  /** Degrees clockwise from the top of the yard photo to true north — 0 (the
   *  default) means the top of the photo IS north. Lets the sun/shade
   *  exposure estimate reason about compass direction from a plain top-down
   *  photo that otherwise carries no orientation information. */
  orientationDeg: number;
}

export interface Profile {
  displayName?: string;
  /** A single emoji, picked from a small curated set — see ProfileSettings. */
  avatarIcon?: string;
}

export interface UserSettings {
  userId: string;
  garden: GardenLocation | null;
  profile: Profile;
}

interface UserSettingsRow {
  user_id: string;
  garden_label: string | null;
  garden_lat: number | null;
  garden_lon: number | null;
  garden_orientation_deg: number | null;
  display_name: string | null;
  avatar_icon: string | null;
  created_at: string;
  updated_at: string;
}

function toSettings(row: UserSettingsRow): UserSettings {
  const hasLocation = row.garden_lat != null && row.garden_lon != null;
  return {
    userId: row.user_id,
    garden: hasLocation
      ? {
          label: row.garden_label ?? undefined,
          latitude: row.garden_lat as number,
          longitude: row.garden_lon as number,
          orientationDeg: row.garden_orientation_deg ?? 0,
        }
      : null,
    profile: {
      displayName: row.display_name ?? undefined,
      avatarIcon: row.avatar_icon ?? undefined,
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

  /** Upserts on user_id, since a settings row may not exist yet. */
  async saveGardenLocation(userId: string, garden: GardenLocation): Promise<UserSettings> {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          garden_label: garden.label ?? null,
          garden_lat: garden.latitude,
          garden_lon: garden.longitude,
          garden_orientation_deg: garden.orientationDeg,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) throw error;
    return toSettings(data as UserSettingsRow);
  },

  /** Just the orientation, independent of re-picking the location. */
  async saveOrientation(userId: string, orientationDeg: number): Promise<UserSettings> {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: userId, garden_orientation_deg: orientationDeg },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) throw error;
    return toSettings(data as UserSettingsRow);
  },

  /** Upserts on user_id, same as saveGardenLocation — leaves garden_* columns untouched. */
  async saveProfile(userId: string, profile: Profile): Promise<UserSettings> {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          display_name: profile.displayName?.trim() || null,
          avatar_icon: profile.avatarIcon ?? null,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) throw error;
    return toSettings(data as UserSettingsRow);
  },

  async clearGardenLocation(userId: string): Promise<void> {
    const { error } = await supabase
      .from('user_settings')
      .update({ garden_label: null, garden_lat: null, garden_lon: null })
      .eq('user_id', userId);

    if (error) throw error;
  },
};
