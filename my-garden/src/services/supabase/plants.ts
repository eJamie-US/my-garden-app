// src/services/supabase/plants.ts

import { supabase } from '../../lib/supabase';
import type { Plant } from '../../types';
import { blobToFile } from '../../utils/imageUtils';

interface PlantRow {
  id: string;
  user_id: string;
  name: string;
  common_name: string | null;
  species: string | null;
  location: { x: number; y: number } | null;
  photo_url: string | null;
  sprite_url: string | null;
  planted_date: string | null;
  last_watered: string | null;
  notes: string | null;
  watering_schedule: Plant['wateringSchedule'] | null;
  sun_requirement: Plant['sunRequirement'] | null;
  created_at: string;
  updated_at: string;
}

/**
 * Rows came back snake_case and were previously cast straight to Plant, so
 * plant.location.x was undefined on every read. Map explicitly instead.
 */
function toPlant(row: PlantRow): Plant {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    commonName: row.common_name ?? undefined,
    species: row.species ?? undefined,
    location: {
      x: Number(row.location?.x ?? 50),
      y: Number(row.location?.y ?? 50),
    },
    photoUrl: row.photo_url ?? undefined,
    spriteUrl: row.sprite_url ?? undefined,
    plantedDate: row.planted_date ?? row.created_at,
    lastWatered: row.last_watered ?? undefined,
    notes: row.notes ?? undefined,
    wateringSchedule: row.watering_schedule ?? 'weekly',
    sunRequirement: row.sun_requirement ?? 'partial-shade',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Only defined keys are sent, so a partial update can't null out a column. */
function toRow(plant: Partial<Plant>) {
  const row: Record<string, unknown> = {};
  if (plant.userId !== undefined) row.user_id = plant.userId;
  if (plant.name !== undefined) row.name = plant.name;
  if (plant.commonName !== undefined) row.common_name = plant.commonName ?? null;
  if (plant.species !== undefined) row.species = plant.species ?? null;
  if (plant.location !== undefined) row.location = plant.location;
  if (plant.photoUrl !== undefined) row.photo_url = plant.photoUrl ?? null;
  if (plant.spriteUrl !== undefined) row.sprite_url = plant.spriteUrl ?? null;
  if (plant.plantedDate !== undefined) row.planted_date = plant.plantedDate ?? null;
  if (plant.lastWatered !== undefined) row.last_watered = plant.lastWatered ?? null;
  if (plant.notes !== undefined) row.notes = plant.notes ?? null;
  if (plant.wateringSchedule !== undefined) row.watering_schedule = plant.wateringSchedule;
  if (plant.sunRequirement !== undefined) row.sun_requirement = plant.sunRequirement;
  return row;
}

export const plantsService = {
  async getPlants(userId: string): Promise<Plant[]> {
    const { data, error } = await supabase
      .from('plants')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as PlantRow[] | null)?.map(toPlant) ?? [];
  },

  async getPlant(id: string): Promise<Plant | null> {
    const { data, error } = await supabase
      .from('plants')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data ? toPlant(data as PlantRow) : null;
  },

  async createPlant(
    plant: Omit<Plant, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Plant> {
    const { data, error } = await supabase
      .from('plants')
      .insert(toRow(plant))
      .select()
      .single();

    if (error) throw error;
    return toPlant(data as PlantRow);
  },

  async updatePlant(id: string, updates: Partial<Plant>): Promise<Plant> {
    const { data, error } = await supabase
      .from('plants')
      .update(toRow(updates))
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toPlant(data as PlantRow);
  },

  async deletePlant(id: string): Promise<void> {
    const { error } = await supabase.from('plants').delete().eq('id', id);
    if (error) throw error;
  },

  /** `kind` keeps the original photo and its cut-out sprite side by side. */
  async uploadPlantPhoto(
    userId: string,
    plantId: string,
    file: Blob,
    kind: 'photo' | 'sprite' = 'photo',
  ): Promise<string> {
    const extension = file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${userId}/${plantId}/${kind}-${Date.now()}.${extension}`;

    const { data, error } = await supabase.storage
      .from('plant-photos')
      .upload(fileName, blobToFile(file, fileName), {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('plant-photos')
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  },
};
