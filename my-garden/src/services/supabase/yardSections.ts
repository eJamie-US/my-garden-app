// src/services/supabase/yardSections.ts

import { supabase } from '../../lib/supabase';
import type { YardSection } from '../../types';

interface YardSectionRow {
  id: string;
  yard_id: string;
  name: string;
  box_x0: number;
  box_y0: number;
  box_x1: number;
  box_y1: number;
  created_at: string;
  updated_at: string;
}

function toSection(row: YardSectionRow): YardSection {
  return {
    id: row.id,
    yardId: row.yard_id,
    name: row.name,
    boxX0: row.box_x0,
    boxY0: row.box_y0,
    boxX1: row.box_x1,
    boxY1: row.box_y1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const yardSectionsService = {
  async getForYard(yardId: string): Promise<YardSection[]> {
    const { data, error } = await supabase
      .from('yard_sections')
      .select('*')
      .eq('yard_id', yardId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as YardSectionRow[] | null)?.map(toSection) ?? [];
  },

  async create(
    yardId: string,
    section: Pick<YardSection, 'name' | 'boxX0' | 'boxY0' | 'boxX1' | 'boxY1'>,
  ): Promise<YardSection> {
    const { data, error } = await supabase
      .from('yard_sections')
      .insert({
        yard_id: yardId,
        name: section.name.trim() || 'Section',
        box_x0: section.boxX0,
        box_y0: section.boxY0,
        box_x1: section.boxX1,
        box_y1: section.boxY1,
      })
      .select()
      .single();

    if (error) throw error;
    return toSection(data as YardSectionRow);
  },

  async update(
    id: string,
    updates: Partial<Pick<YardSection, 'name' | 'boxX0' | 'boxY0' | 'boxX1' | 'boxY1'>>,
  ): Promise<YardSection> {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name.trim() || 'Section';
    if (updates.boxX0 !== undefined) patch.box_x0 = updates.boxX0;
    if (updates.boxY0 !== undefined) patch.box_y0 = updates.boxY0;
    if (updates.boxX1 !== undefined) patch.box_x1 = updates.boxX1;
    if (updates.boxY1 !== undefined) patch.box_y1 = updates.boxY1;

    const { data, error } = await supabase
      .from('yard_sections')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toSection(data as YardSectionRow);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('yard_sections').delete().eq('id', id);
    if (error) throw error;
  },
};
