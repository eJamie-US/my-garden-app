// src/services/supabase/yards.ts

import { supabase } from '../../lib/supabase';
import type { Yard } from '../../types';
import { blobToFile } from '../../utils/imageUtils';

interface YardRow {
  id: string;
  user_id: string;
  name: string;
  image_url: string;
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  orientation_deg: number;
  created_at: string;
  updated_at: string;
}

function toYard(row: YardRow): Yard {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    imageUrl: row.image_url,
    label: row.label ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    orientationDeg: row.orientation_deg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const yardsService = {
  async getForUser(userId: string): Promise<Yard[]> {
    const { data, error } = await supabase
      .from('yards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as YardRow[] | null)?.map(toYard) ?? [];
  },

  async create(
    userId: string,
    yard: Partial<Pick<Yard, 'name' | 'imageUrl' | 'label' | 'latitude' | 'longitude' | 'orientationDeg'>>,
  ): Promise<Yard> {
    const { data, error } = await supabase
      .from('yards')
      .insert({
        user_id: userId,
        name: yard.name?.trim() || 'My Garden',
        image_url: yard.imageUrl ?? '/default-yard.png',
        label: yard.label ?? null,
        latitude: yard.latitude ?? null,
        longitude: yard.longitude ?? null,
        orientation_deg: yard.orientationDeg ?? 0,
      })
      .select()
      .single();

    if (error) throw error;
    return toYard(data as YardRow);
  },

  async update(
    id: string,
    updates: Partial<Pick<Yard, 'name' | 'imageUrl' | 'label' | 'latitude' | 'longitude' | 'orientationDeg'>>,
  ): Promise<Yard> {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name.trim() || 'My Garden';
    if (updates.imageUrl !== undefined) patch.image_url = updates.imageUrl;
    if (updates.label !== undefined) patch.label = updates.label ?? null;
    if (updates.latitude !== undefined) patch.latitude = updates.latitude ?? null;
    if (updates.longitude !== undefined) patch.longitude = updates.longitude ?? null;
    if (updates.orientationDeg !== undefined) patch.orientation_deg = updates.orientationDeg;

    const { data, error } = await supabase
      .from('yards')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toYard(data as YardRow);
  },

  /** Removes the yard row — its sections/plants/obstacles cascade via FK. */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('yards').delete().eq('id', id);
    if (error) throw error;
  },

  /** Same bucket/pattern as plantsService.uploadPlantPhoto, under its own
   *  prefix — reuses the existing public plant-photos bucket rather than
   *  standing up a new one just for yard photos. */
  async uploadPhoto(userId: string, yardId: string, file: Blob): Promise<string> {
    const extension = file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${userId}/yard-photos/${yardId}-${Date.now()}.${extension}`;

    const { data, error } = await supabase.storage
      .from('plant-photos')
      .upload(fileName, blobToFile(file, fileName), {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from('plant-photos').getPublicUrl(data.path);
    return urlData.publicUrl;
  },
};
