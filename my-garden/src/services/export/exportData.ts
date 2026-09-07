// src/services/export/exportData.ts
// "Download my garden data" — a full JSON snapshot of everything in the
// account (yards, sections, obstacles, plants, care items), for backup and
// peace of mind since this becomes someone's real gardening record. Fetches
// fresh via the same services the rest of the app already uses, then
// triggers a plain browser download — no server endpoint needed.
//
// Photos themselves aren't embedded, only their storage URLs — downloading
// and re-encoding every photo as base64 would balloon this into a huge file
// for something meant to be a quick, readable backup, and the photos
// already live durably in Supabase Storage independent of this export.

import { yardsService } from '../supabase/yards';
import { yardSectionsService } from '../supabase/yardSections';
import { yardObstaclesService } from '../supabase/yardObstacles';
import { plantsService } from '../supabase/plants';
import { careItemsService } from '../supabase/careItems';
import type { CareItem, Plant, Yard, YardObstacle, YardSection } from '../../types';

export interface GardenDataExport {
  exportedAt: string;
  yards: Yard[];
  sections: YardSection[];
  obstacles: YardObstacle[];
  plants: Plant[];
  careItems: CareItem[];
}

export async function exportGardenData(userId: string): Promise<GardenDataExport> {
  const [yards, obstacles, plants, careItems] = await Promise.all([
    yardsService.getForUser(userId),
    yardObstaclesService.getForUser(userId),
    plantsService.getPlants(userId),
    careItemsService.getForUser(userId),
  ]);

  const sectionsByYard = await Promise.all(yards.map((y) => yardSectionsService.getForYard(y.id)));

  return {
    exportedAt: new Date().toISOString(),
    yards,
    sections: sectionsByYard.flat(),
    obstacles,
    plants,
    careItems,
  };
}

/** Triggers a plain browser download of the given data as a JSON file. */
export function downloadAsJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
