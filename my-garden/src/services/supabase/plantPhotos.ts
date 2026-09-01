// src/services/supabase/plantPhotos.ts

import { supabase } from '../../lib/supabase';
import type { PlantPhoto } from '../../types';
import { plantsService } from './plants';

/** getPublicUrl() shapes URLs as `{project}/storage/v1/object/public/{bucket}/{path}` — pull the path back out of one. */
function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/object/public/plant-photos/';
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

interface PlantPhotoRow {
  id: string;
  plant_id: string;
  user_id: string;
  photo_url: string;
  sprite_url: string | null;
  taken_at: string;
  note: string | null;
  identified_species: string | null;
  identified_score: number | null;
  created_at: string;
}

function toPlantPhoto(row: PlantPhotoRow): PlantPhoto {
  return {
    id: row.id,
    plantId: row.plant_id,
    userId: row.user_id,
    photoUrl: row.photo_url,
    spriteUrl: row.sprite_url ?? undefined,
    takenAt: row.taken_at,
    note: row.note ?? undefined,
    identifiedSpecies: row.identified_species ?? undefined,
    identifiedScore: row.identified_score ?? undefined,
    createdAt: row.created_at,
  };
}

export interface AddPhotoInput {
  photo: Blob;
  sprite?: Blob | null;
  takenAt?: string;
  note?: string;
  identifiedSpecies?: string;
  identifiedScore?: number;
  /** Also point plants.photo_url / sprite_url at this one. Default true. */
  makeCurrent?: boolean;
}

export const plantPhotosService = {
  /** Oldest first — that is the order a progression reads in. */
  async getForPlant(plantId: string): Promise<PlantPhoto[]> {
    const { data, error } = await supabase
      .from('plant_photos')
      .select('*')
      .eq('plant_id', plantId)
      .order('taken_at', { ascending: true });

    if (error) throw error;
    return (data as PlantPhotoRow[] | null)?.map(toPlantPhoto) ?? [];
  },

  async getLatestForUser(userId: string): Promise<Map<string, PlantPhoto>> {
    const { data, error } = await supabase
      .from('plant_photos')
      .select('*')
      .eq('user_id', userId)
      .order('taken_at', { ascending: false });

    if (error) throw error;
    const latest = new Map<string, PlantPhoto>();
    for (const row of (data as PlantPhotoRow[] | null) ?? []) {
      if (!latest.has(row.plant_id)) latest.set(row.plant_id, toPlantPhoto(row));
    }
    return latest;
  },

  /** Uploads both blobs, writes the timeline row, optionally updates the plant. */
  async addPhoto(
    userId: string,
    plantId: string,
    {
      photo, sprite, takenAt, note,
      identifiedSpecies, identifiedScore, makeCurrent = true,
    }: AddPhotoInput,
  ): Promise<PlantPhoto> {
    const photoUrl = await plantsService.uploadPlantPhoto(userId, plantId, photo, 'photo');
    const spriteUrl = sprite
      ? await plantsService.uploadPlantPhoto(userId, plantId, sprite, 'sprite')
      : null;

    const { data, error } = await supabase
      .from('plant_photos')
      .insert({
        plant_id: plantId,
        user_id: userId,
        photo_url: photoUrl,
        sprite_url: spriteUrl,
        taken_at: takenAt ?? new Date().toISOString(),
        note: note ?? null,
        identified_species: identifiedSpecies ?? null,
        identified_score: identifiedScore ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    if (makeCurrent) {
      // Non-fatal: the timeline row is the record of truth.
      await plantsService
        .updatePlant(plantId, { photoUrl, spriteUrl: spriteUrl ?? photoUrl })
        .catch((err) => console.error('Could not set current photo', err));
    }

    return toPlantPhoto(data as PlantPhotoRow);
  },

  async updatePhoto(
    id: string,
    updates: Pick<Partial<PlantPhoto>, 'note' | 'takenAt'>,
  ): Promise<PlantPhoto> {
    const patch: Record<string, unknown> = {};
    if (updates.note !== undefined) patch.note = updates.note ?? null;
    if (updates.takenAt !== undefined) patch.taken_at = updates.takenAt;

    const { data, error } = await supabase
      .from('plant_photos')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toPlantPhoto(data as PlantPhotoRow);
  },

  /** Takes the photo (not just its id) so it can clean up the storage
   *  files the row points to — the DB row alone doesn't carry enough to
   *  find them afterwards. Best-effort on storage, same reasoning as
   *  plantsService.deletePlant: don't let a storage hiccup block removing
   *  the row itself. */
  async deletePhoto(photo: Pick<PlantPhoto, 'id' | 'photoUrl' | 'spriteUrl'>): Promise<void> {
    const paths = [photo.photoUrl, photo.spriteUrl]
      .filter((url): url is string => Boolean(url))
      .map(storagePathFromPublicUrl)
      .filter((p): p is string => Boolean(p));

    if (paths.length) {
      const { error } = await supabase.storage.from('plant-photos').remove(paths);
      if (error) console.error(`Could not remove stored photo(s) for ${photo.id}:`, error);
    }

    const { error } = await supabase.from('plant_photos').delete().eq('id', photo.id);
    if (error) throw error;
  },

  /** Days between the first and last photo — "tracked for N days". */
  spanInDays(photos: PlantPhoto[]): number {
    if (photos.length < 2) return 0;
    const first = new Date(photos[0].takenAt).getTime();
    const last = new Date(photos[photos.length - 1].takenAt).getTime();
    return Math.round((last - first) / 86_400_000);
  },
};
