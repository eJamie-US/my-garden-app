// src/services/supabase/yardObstacles.ts

import { supabase } from '../../lib/supabase';
import type { ObstacleEdge, ObstacleHeightTier, ObstacleShape, YardObstacle, YardObstacleType } from '../../types';

interface YardObstacleRow {
  id: string;
  user_id: string;
  type: YardObstacleType;
  label: string | null;
  location: { x: number; y: number };
  shape: ObstacleShape | null;
  height_tier: ObstacleHeightTier;
  open_edges: ObstacleEdge[] | null;
  created_at: string;
  updated_at: string;
}

function toObstacle(row: YardObstacleRow): YardObstacle {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    label: row.label ?? undefined,
    location: { x: Number(row.location?.x ?? 50), y: Number(row.location?.y ?? 50) },
    shape: row.shape ?? undefined,
    heightTier: row.height_tier,
    openEdges: row.open_edges ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const yardObstaclesService = {
  async getForUser(userId: string): Promise<YardObstacle[]> {
    const { data, error } = await supabase
      .from('yard_obstacles')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as YardObstacleRow[] | null)?.map(toObstacle) ?? [];
  },

  async create(
    userId: string,
    obstacle: Pick<YardObstacle, 'type' | 'location' | 'heightTier'> &
      Partial<Pick<YardObstacle, 'label' | 'shape' | 'openEdges'>>,
  ): Promise<YardObstacle> {
    const { data, error } = await supabase
      .from('yard_obstacles')
      .insert({
        user_id: userId,
        type: obstacle.type,
        label: obstacle.label ?? null,
        location: obstacle.location,
        shape: obstacle.shape ?? null,
        height_tier: obstacle.heightTier,
        open_edges: obstacle.openEdges ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return toObstacle(data as YardObstacleRow);
  },

  async update(
    id: string,
    updates: Partial<Pick<YardObstacle, 'type' | 'label' | 'location' | 'shape' | 'heightTier' | 'openEdges'>>,
  ): Promise<YardObstacle> {
    const patch: Record<string, unknown> = {};
    if (updates.type !== undefined) patch.type = updates.type;
    if (updates.label !== undefined) patch.label = updates.label ?? null;
    if (updates.location !== undefined) patch.location = updates.location;
    if (updates.shape !== undefined) patch.shape = updates.shape ?? null;
    if (updates.heightTier !== undefined) patch.height_tier = updates.heightTier;
    if (updates.openEdges !== undefined) patch.open_edges = updates.openEdges ?? null;

    const { data, error } = await supabase
      .from('yard_obstacles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toObstacle(data as YardObstacleRow);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('yard_obstacles').delete().eq('id', id);
    if (error) throw error;
  },
};
