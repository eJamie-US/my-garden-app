// src/services/supabase/careItems.ts

import { supabase } from '../../lib/supabase';
import type { CareItem, CareIngredient, DraftCareItem } from '../../types';
import { nextDueFrom } from '../care/generateCareItems';
import { today } from '../../utils/careDisplay';

interface CareItemRow {
  id: string;
  plant_id: string;
  user_id: string;
  title: string;
  kind: CareItem['kind'];
  frequency_every: number;
  frequency_unit: CareItem['frequency']['unit'];
  ingredients: CareIngredient[] | null;
  instructions: string | null;
  next_due_date: string | null;
  last_completed_at: string | null;
  source: CareItem['source'];
  created_at: string;
  updated_at: string;
}

function toCareItem(row: CareItemRow): CareItem {
  return {
    id: row.id,
    plantId: row.plant_id,
    userId: row.user_id,
    title: row.title,
    kind: row.kind,
    frequency: { every: row.frequency_every, unit: row.frequency_unit },
    ingredients: row.ingredients ?? [],
    instructions: row.instructions ?? undefined,
    nextDueDate: row.next_due_date ?? undefined,
    lastCompletedAt: row.last_completed_at ?? undefined,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(item: DraftCareItem | CareItem, plantId: string, userId: string) {
  return {
    plant_id: plantId,
    user_id: userId,
    title: item.title,
    kind: item.kind,
    frequency_every: item.frequency.every,
    frequency_unit: item.frequency.unit,
    ingredients: item.ingredients ?? [],
    instructions: item.instructions ?? null,
    // A brand-new item (no explicit date) starts due today, not a full
    // frequency-cycle from now — see generateCareItems.ts's file header.
    next_due_date: item.nextDueDate ?? today(),
    last_completed_at: item.lastCompletedAt ?? null,
    source: item.source,
  };
}

export const careItemsService = {
  async getForPlant(plantId: string): Promise<CareItem[]> {
    const { data, error } = await supabase
      .from('care_items')
      .select('*')
      .eq('plant_id', plantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CareItemRow[] | null)?.map(toCareItem) ?? [];
  },

  async getForUser(userId: string): Promise<CareItem[]> {
    const { data, error } = await supabase
      .from('care_items')
      .select('*')
      .eq('user_id', userId)
      .order('next_due_date', { ascending: true, nullsFirst: false });

    if (error) throw error;
    return (data as CareItemRow[] | null)?.map(toCareItem) ?? [];
  },

  /** Used by the add-plant flow: writes the whole edited list in one round trip. */
  async createMany(
    plantId: string,
    userId: string,
    items: Array<DraftCareItem | CareItem>,
  ): Promise<CareItem[]> {
    if (!items.length) return [];

    const { data, error } = await supabase
      .from('care_items')
      .insert(items.map((i) => toRow(i, plantId, userId)))
      .select();

    if (error) throw error;
    return (data as CareItemRow[]).map(toCareItem);
  },

  async updateCareItem(id: string, updates: Partial<CareItem>): Promise<CareItem> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.kind !== undefined) patch.kind = updates.kind;
    if (updates.frequency !== undefined) {
      patch.frequency_every = updates.frequency.every;
      patch.frequency_unit = updates.frequency.unit;
    }
    if (updates.ingredients !== undefined) patch.ingredients = updates.ingredients;
    if (updates.instructions !== undefined) patch.instructions = updates.instructions ?? null;
    if (updates.nextDueDate !== undefined) patch.next_due_date = updates.nextDueDate ?? null;
    if (updates.lastCompletedAt !== undefined) {
      patch.last_completed_at = updates.lastCompletedAt ?? null;
    }

    const { data, error } = await supabase
      .from('care_items')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toCareItem(data as CareItemRow);
  },

  /** Marks done and rolls next_due_date forward by the item's own frequency. */
  async complete(item: CareItem, when: Date = new Date()): Promise<CareItem> {
    return await careItemsService.updateCareItem(item.id, {
      lastCompletedAt: when.toISOString(),
      nextDueDate: nextDueFrom(item.frequency, when),
    });
  },

  async deleteCareItem(id: string): Promise<void> {
    const { error } = await supabase.from('care_items').delete().eq('id', id);
    if (error) throw error;
  },

  /** Replaces generated items only — anything the user wrote by hand survives. */
  async replaceGenerated(
    plantId: string,
    userId: string,
    items: Array<DraftCareItem | CareItem>,
  ): Promise<CareItem[]> {
    const { error: delError } = await supabase
      .from('care_items')
      .delete()
      .eq('plant_id', plantId)
      .eq('source', 'generated');

    if (delError) throw delError;
    return await careItemsService.createMany(plantId, userId, items);
  },
};
