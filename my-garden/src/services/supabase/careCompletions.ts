// src/services/supabase/careCompletions.ts
// The append-only completion log (care_completions, migration 031) plus the
// two SECURITY DEFINER RPCs that read/write it atomically alongside
// care_items — see that migration's header for why plain sequential client
// calls (update care_items, then insert a log row) aren't safe here.

import { supabase } from '../../lib/supabase';
import type { CareCompletion, CareItem } from '../../types';
import { toCareItem, type CareItemRow } from './careItems';

interface CareCompletionRow {
  id: string;
  care_item_id: string;
  plant_id: string;
  user_id: string;
  completed_at: string;
  previous_last_completed_at: string | null;
  previous_next_due_date: string | null;
  new_next_due_date: string | null;
  created_at: string;
  care_items: { title: string; kind: CareItem['kind'] } | null;
}

function toCareCompletion(row: CareCompletionRow): CareCompletion {
  return {
    id: row.id,
    careItemId: row.care_item_id,
    plantId: row.plant_id,
    userId: row.user_id,
    itemTitle: row.care_items?.title ?? '',
    itemKind: row.care_items?.kind ?? 'other',
    completedAt: row.completed_at,
    previousLastCompletedAt: row.previous_last_completed_at ?? undefined,
    previousNextDueDate: row.previous_next_due_date ?? undefined,
    newNextDueDate: row.new_next_due_date ?? undefined,
    createdAt: row.created_at,
  };
}

export const careCompletionsService = {
  async getForPlant(plantId: string): Promise<CareCompletion[]> {
    const { data, error } = await supabase
      .from('care_completions')
      .select('*, care_items(title, kind)')
      .eq('plant_id', plantId)
      .order('completed_at', { ascending: false });

    if (error) throw error;
    return (data as CareCompletionRow[] | null)?.map(toCareCompletion) ?? [];
  },

  /** Marks done via complete_care_item — inserts the log row and rolls
   *  next_due_date forward in one atomic call. `when` defaults to now but
   *  can be backdated (up to a few days, enforced by the UI) for a task the
   *  user forgot to log at the time. */
  async complete(careItemId: string, when: Date = new Date()): Promise<CareItem> {
    const { data, error } = await supabase.rpc('complete_care_item', {
      p_care_item_id: careItemId,
      p_when: when.toISOString(),
    });
    if (error) throw error;
    return toCareItem(data as CareItemRow);
  },

  /** Restores care_items from the most recent completion's snapshot and
   *  deletes that log row — only the latest completion per item is
   *  undoable, by construction (see migration 031). */
  async undoLast(careItemId: string): Promise<CareItem> {
    const { data, error } = await supabase.rpc('undo_last_completion', {
      p_care_item_id: careItemId,
    });
    if (error) throw error;
    return toCareItem(data as CareItemRow);
  },

  /** Manual "Clear history older than..." — scoped to the signed-in user by
   *  the DELETE RLS policy regardless, but filtering by user_id here too
   *  keeps the query's intent explicit. */
  async clearOlderThan(userId: string, cutoff: Date): Promise<void> {
    const { error } = await supabase
      .from('care_completions')
      .delete()
      .eq('user_id', userId)
      .lt('created_at', cutoff.toISOString());
    if (error) throw error;
  },
};
