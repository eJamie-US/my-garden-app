import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { daysUntil, dueLabel, dueBadgeClass, ingredientSummary } from './careDisplay';
import type { CareItem } from '../types';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('daysUntil', () => {
  it('returns null for a missing date — "not scheduled", not "due now"', () => {
    expect(daysUntil(undefined)).toBeNull();
  });

  it('returns 0 for today', () => {
    expect(daysUntil('2026-06-15')).toBe(0);
  });

  it('returns a positive count for a future date', () => {
    expect(daysUntil('2026-06-20')).toBe(5);
  });

  it('returns a negative count for a past (overdue) date', () => {
    expect(daysUntil('2026-06-10')).toBe(-5);
  });
});

describe('dueLabel', () => {
  it('labels null as not scheduled', () => {
    expect(dueLabel(null)).toBe('not scheduled');
  });
  it('labels negative days as overdue with the day count', () => {
    expect(dueLabel(-3)).toBe('overdue 3d');
  });
  it('labels 0 as due today', () => {
    expect(dueLabel(0)).toBe('due today');
  });
  it('labels 1 as due tomorrow', () => {
    expect(dueLabel(1)).toBe('due tomorrow');
  });
  it('labels other future days generically', () => {
    expect(dueLabel(4)).toBe('due in 4d');
  });
});

describe('dueBadgeClass', () => {
  it('is neutral gray for not-scheduled', () => {
    expect(dueBadgeClass(null)).toContain('gray');
  });
  it('is amber for due-or-overdue (<=0)', () => {
    expect(dueBadgeClass(0)).toContain('amber');
    expect(dueBadgeClass(-1)).toContain('amber');
  });
  it('is emerald for upcoming (>0)', () => {
    expect(dueBadgeClass(1)).toContain('emerald');
  });
});

describe('ingredientSummary', () => {
  const base: CareItem = {
    id: 'c1',
    plantId: 'p1',
    userId: 'u1',
    title: 'Water',
    kind: 'water',
    frequency: { every: 1, unit: 'week' },
    ingredients: [],
    source: 'generated',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  it('falls back to instructions when there are no ingredients', () => {
    expect(ingredientSummary({ ...base, instructions: 'Water deeply.' })).toBe('Water deeply.');
  });

  it('returns an empty string when there are neither ingredients nor instructions', () => {
    expect(ingredientSummary(base)).toBe('');
  });

  it('joins ingredients as "amount unit name", separated by middot', () => {
    const item: CareItem = {
      ...base,
      ingredients: [
        { id: 'i1', name: 'Water', amount: '1', unit: 'gal' },
        { id: 'i2', name: 'Epsom salt', amount: '1/2', unit: 'tsp' },
      ],
    };
    expect(ingredientSummary(item)).toBe('1 gal Water · 1/2 tsp Epsom salt');
  });
});
