// src/hooks/useCareItems.ts
import { create } from 'zustand';
import type { CareIngredient, CareItem, DraftCareItem, Plant, WeatherData } from '../types';
import { careItemsService } from '../services/supabase/careItems';
import { generateCareItems, nextDueFrom } from '../services/care/generateCareItems';

interface CareItemsState {
  items: CareItem[];
  loading: boolean;
  error: string | null;
  fetchForUser: (userId: string) => Promise<void>;
  completeItem: (item: CareItem) => Promise<void>;
  /** Completes a batch in one go — e.g. "mark all water done" from a kind filter. */
  completeMany: (items: CareItem[]) => Promise<void>;
  refreshFromWeather: (plants: Plant[], weather: WeatherData | null | undefined, userId: string) => Promise<void>;
}

function ingredientsKey(list: CareIngredient[]): string {
  return list.map((i) => `${i.name}|${i.amount}|${i.unit}`).join(';');
}

/**
 * Compares a plant's freshly-generated (weather-aware) suggestion against
 * its already-persisted item of the same kind, and returns only the fields
 * that actually changed — or null if nothing did. This is what keeps
 * refreshFromWeather's writes down to "only the items whose suggestion
 * actually changed" instead of rewriting every generated item on every
 * app open.
 */
function buildRefreshPatch(existing: CareItem, fresh: DraftCareItem): Partial<CareItem> | null {
  const patch: Partial<CareItem> = {};

  if (existing.title !== fresh.title) patch.title = fresh.title;
  if (
    existing.frequency.every !== fresh.frequency.every ||
    existing.frequency.unit !== fresh.frequency.unit
  ) {
    patch.frequency = fresh.frequency;
  }
  if (ingredientsKey(existing.ingredients) !== ingredientsKey(fresh.ingredients)) {
    patch.ingredients = fresh.ingredients;
  }
  if ((existing.instructions ?? '') !== (fresh.instructions ?? '')) {
    patch.instructions = fresh.instructions;
  }

  // Move the due date only off a known anchor — the last time this item was
  // actually completed. Re-deriving it from the item's OWN previous due date
  // would compound drift a little more every time the app is opened. An item
  // that has never been completed keeps whatever due date it already has
  // (already "due today" for anything created since the earlier fix), since
  // there's no safe anchor to re-derive a new one from.
  if (existing.lastCompletedAt) {
    const recomputedDue = nextDueFrom(fresh.frequency, new Date(existing.lastCompletedAt));
    if (recomputedDue !== existing.nextDueDate) {
      patch.nextDueDate = recomputedDue;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export const useCareItems = create<CareItemsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchForUser: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const items = await careItemsService.getForUser(userId);
      set({ items, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load care items', loading: false });
    }
  },

  completeItem: async (item: CareItem) => {
    try {
      const updated = await careItemsService.complete(item);
      set({ items: get().items.map((i) => (i.id === item.id ? updated : i)) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not save that' });
      throw err;
    }
  },

  // Fires all the completions in parallel, then reconciles from whichever
  // resolved — same "still show what actually saved" approach as a single
  // completeItem, just batched for a "mark all done" action.
  completeMany: async (items: CareItem[]) => {
    if (!items.length) return;
    const settled = await Promise.allSettled(items.map((item) => careItemsService.complete(item)));
    const updatedById = new Map<string, CareItem>();
    let failures = 0;
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') updatedById.set(items[i].id, result.value);
      else failures++;
    });
    if (updatedById.size) {
      set({ items: get().items.map((i) => updatedById.get(i.id) ?? i) });
    }
    if (failures) {
      // Thrown with the same text that's set on the store, so a caller that
      // displays err.message (same pattern as completeItem) shows the real
      // reason instead of a generic marker string.
      const message =
        failures === items.length
          ? 'Could not save any of those'
          : `${failures} of ${items.length} didn't save — try again`;
      set({ error: message });
      throw new Error(message);
    }
  },

  // Re-derives each plant's *generated* care items from the current weather
  // snapshot (past rainfall/sun + upcoming forecast) without disturbing
  // anything the user typed themselves. Matched by `kind`, since each
  // species profile currently produces at most one generated item per kind.
  // Each matched item is diffed (buildRefreshPatch) against its fresh
  // suggestion, and only written back to Supabase if something actually
  // changed — including, when the item has a completion history, whether
  // today's weather moves its next due date earlier or later.
  refreshFromWeather: async (plants, weather, userId) => {
    try {
      const currentItems = get().items;
      await Promise.all(
        plants.map(async (plant) => {
          const generated = generateCareItems(
            { name: plant.name, commonName: plant.commonName, species: plant.species, sunRequirement: plant.sunRequirement },
            weather,
          ).items;

          const existingForPlant = currentItems.filter((i) => i.plantId === plant.id && i.source === 'generated');
          const existingByKind = new Map(existingForPlant.map((i) => [i.kind, i]));
          const freshKinds = new Set(generated.map((i) => i.kind));

          const work: Promise<unknown>[] = [];
          const toCreate: DraftCareItem[] = [];

          for (const fresh of generated) {
            const existing = existingByKind.get(fresh.kind);
            if (existing) {
              const patch = buildRefreshPatch(existing, fresh);
              if (patch) work.push(careItemsService.updateCareItem(existing.id, patch));
            } else {
              toCreate.push(fresh);
            }
          }

          if (toCreate.length) work.push(careItemsService.createMany(plant.id, userId, toCreate));

          for (const existing of existingForPlant) {
            if (!freshKinds.has(existing.kind)) work.push(careItemsService.deleteCareItem(existing.id));
          }

          await Promise.all(work);
        }),
      );
      await get().fetchForUser(userId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not refresh care plans' });
    }
  },
}));
