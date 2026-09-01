import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCareItems } from './useCareItems';
import { careItemsService } from '../services/supabase/careItems';
import type { CareItem } from '../types';

vi.mock('../services/supabase/careItems', () => ({
  careItemsService: {
    complete: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  useCareItems.setState({ items: [], loading: false, error: null });
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
