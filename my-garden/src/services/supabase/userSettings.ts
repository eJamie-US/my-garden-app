// src/services/supabase/userSettings.ts

import { supabase } from '../../lib/supabase';

export interface GardenLocation {
  label?: string;
  latitude: number;
  longitude: number;
}

export interface UserSettings {
  userId: string;
  garden: GardenLocation | null;
}

interface UserSettingsRow {
  user_id: string;
  garden_label: string | null;
  garden_lat: number | null;
  garden_lon: number | null;
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
        }
      : null,
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
