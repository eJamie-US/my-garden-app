import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCareItems } from './useCareItems';
import { careItemsService } from '../services/supabase/careItems';
import type { CareItem, Plant } from '../types';

vi.mock('../services/supabase/careItems', () => ({
  careItemsService: {
    complete: vi.fn(),
    updateCareItem: vi.fn(),
    deleteCareItem: vi.fn(),
    createMany: vi.fn(),
    getForUser: vi.fn(),
  },
}));

function makeItem(id: string): CareItem {
  return {
    id,
    plantId: 'p1',
    userId: 'u1',
    title: 'Water',
    kind: 'water',
    frequency: { every: 1, unit: 'week' },
    ingredients: [],
    nextDueDate: '2026-06-10',
    source: 'generated',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function makePlant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'p1',
    userId: 'u1',
    yardId: 'y1',
    name: 'Mystery Plant',
    location: { x: 50, y: 50 },
    plantedDate: '2026-01-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCareItems.setState({ items: [], loading: false, error: null });
  vi.mocked(careItemsService.updateCareItem).mockResolvedValue({} as CareItem);
  vi.mocked(careItemsService.deleteCareItem).mockResolvedValue(undefined);
  vi.mocked(careItemsService.createMany).mockResolvedValue([]);
  vi.mocked(careItemsService.getForUser).mockResolvedValue([]);
});

describe('useCareItems.completeItem', () => {
  it('replaces the completed item with the service response', async () => {
    const item = makeItem('c1');
    useCareItems.setState({ items: [item] });
    const updated = { ...item, nextDueDate: '2026-06-17', lastCompletedAt: '2026-06-10T00:00:00Z' };
    vi.mocked(careItemsService.complete).mockResolvedValueOnce(updated);

    await useCareItems.getState().completeItem(item);

    expect(useCareItems.getState().items).toEqual([updated]);
    expect(useCareItems.getState().error).toBeNull();
  });

  it('sets an error and rethrows on failure', async () => {
    const item = makeItem('c1');
    useCareItems.setState({ items: [item] });
    vi.mocked(careItemsService.complete).mockRejectedValueOnce(new Error('network down'));

    await expect(useCareItems.getState().completeItem(item)).rejects.toThrow('network down');
    expect(useCareItems.getState().error).toBe('network down');
    // The item is untouched — no half-applied update from a failed save.
    expect(useCareItems.getState().items).toEqual([item]);
  });
});

describe('useCareItems.completeMany', () => {
  it('does nothing for an empty list', async () => {
    await useCareItems.getState().completeMany([]);
    expect(careItemsService.complete).not.toHaveBeenCalled();
  });

  it('updates every item when all completions succeed', async () => {
    const items = [makeItem('c1'), makeItem('c2'), makeItem('c3')];
    useCareItems.setState({ items });
    vi.mocked(careItemsService.complete).mockImplementation(async (item) => ({
      ...item,
      nextDueDate: '2026-06-22',
    }));

    await useCareItems.getState().completeMany(items);

    const stored = useCareItems.getState().items;
    expect(stored.every((i) => i.nextDueDate === '2026-06-22')).toBe(true);
    expect(useCareItems.getState().error).toBeNull();
  });

  it('keeps the successes and reports a count when some completions fail', async () => {
    const items = [makeItem('c1'), makeItem('c2'), makeItem('c3')];
    useCareItems.setState({ items });
    vi.mocked(careItemsService.complete).mockImplementation(async (item) => {
      if (item.id === 'c2') throw new Error('boom');
      return { ...item, nextDueDate: '2026-06-22' };
    });

    await expect(useCareItems.getState().completeMany(items)).rejects.toThrow(
      "1 of 3 didn't save — try again",
    );

    const stored = useCareItems.getState().items;
    expect(stored.find((i) => i.id === 'c1')!.nextDueDate).toBe('2026-06-22');
    expect(stored.find((i) => i.id === 'c3')!.nextDueDate).toBe('2026-06-22');
    // The failed one is untouched, not silently marked done.
    expect(stored.find((i) => i.id === 'c2')!.nextDueDate).toBe('2026-06-10');
    expect(useCareItems.getState().error).toBe("1 of 3 didn't save — try again");
  });

  it('reports total failure distinctly and changes nothing when every completion fails', async () => {
    const items = [makeItem('c1'), makeItem('c2')];
    useCareItems.setState({ items });
    vi.mocked(careItemsService.complete).mockRejectedValue(new Error('boom'));

    await expect(useCareItems.getState().completeMany(items)).rejects.toThrow(
      'Could not save any of those',
    );
    expect(useCareItems.getState().items).toEqual(items);
    expect(useCareItems.getState().error).toBe('Could not save any of those');
  });
});

describe('useCareItems.refreshFromWeather', () => {
  // Regression test for the "duplicate care items" bug: existingByKind used
  // to be built as a plain Map<kind, item>, so if a plant ever ended up with
  // two generated items of the same kind, the Map silently kept only the
  // last one — the other was never matched *or* deleted, and just sat there
  // forever. Now it groups by kind and explicitly deletes every extra.
  it('collapses duplicate generated items of the same kind down to one, deleting the rest', async () => {
    const plant = makePlant(); // matches the GENERIC profile: water + feed + inspect, no weather
    const oldWater1 = { ...makeItem('c1'), kind: 'water' as const, title: 'Old Water' };
    const oldWater2 = { ...makeItem('c2'), kind: 'water' as const, title: 'Water' };
    const staleKind = { ...makeItem('c3'), kind: 'prune' as const, title: 'Old prune item' };
    const userItem = { ...makeItem('c4'), kind: 'water' as const, source: 'user' as const };
    useCareItems.setState({ items: [oldWater1, oldWater2, staleKind, userItem] });

    await useCareItems.getState().refreshFromWeather([plant], null, 'u1');

    // The first 'water' item is kept (and patched, since its title
    // differs from the fresh suggestion) — the duplicate is deleted.
    expect(careItemsService.updateCareItem).toHaveBeenCalledWith('c1', expect.any(Object));
    expect(careItemsService.updateCareItem).not.toHaveBeenCalledWith('c2', expect.anything());
    expect(careItemsService.deleteCareItem).toHaveBeenCalledWith('c2');
    // A kind no longer in the fresh set (GENERIC has no 'prune' extra) is removed entirely.
    expect(careItemsService.deleteCareItem).toHaveBeenCalledWith('c3');
    // Kinds with no existing item at all (feed, inspect) are created.
    expect(careItemsService.createMany).toHaveBeenCalledWith(
      'p1',
      'u1',
      expect.arrayContaining([
        expect.objectContaining({ kind: 'feed' }),
        expect.objectContaining({ kind: 'inspect' }),
      ]),
    );
    const created = vi.mocked(careItemsService.createMany).mock.calls[0][2];
    expect(created).toHaveLength(2);
    // A user-written item is never touched by this at all.
    expect(careItemsService.updateCareItem).not.toHaveBeenCalledWith('c4', expect.anything());
    expect(careItemsService.deleteCareItem).not.toHaveBeenCalledWith('c4');
  });
});
