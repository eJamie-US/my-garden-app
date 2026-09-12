import { describe, it, expect } from 'vitest';
import { shiftMonth, matchSeasonalTasks } from './seasonalTasks';
import type { Plant, SeasonalTask } from '../types';

function makePlant(overrides: Partial<Plant> & Pick<Plant, 'id' | 'name'>): Plant {
  return {
    userId: 'u1',
    yardId: 'y1',
    location: { x: 50, y: 50 },
    plantedDate: '2026-01-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

/** Local midnight on the given (1-indexed) month/day — avoids the
 *  UTC-string-parsed-vs-local-getMonth() mismatch a plain ISO date string
 *  can hit depending on the test runner's own time zone. */
function onDate(month: number, day: number): Date {
  return new Date(2026, month - 1, day);
}

describe('shiftMonth', () => {
  it('leaves Northern Hemisphere months unchanged', () => {
    expect(shiftMonth(3, false)).toBe(3);
  });

  it('shifts a Southern Hemisphere month by 6', () => {
    expect(shiftMonth(3, true)).toBe(9);
  });

  it('wraps around the end of the year', () => {
    expect(shiftMonth(10, true)).toBe(4);
    expect(shiftMonth(12, true)).toBe(6);
  });
});

describe('matchSeasonalTasks', () => {
  const propagateInSpring: SeasonalTask = {
    task: 'Propagate',
    months: [3, 4, 5],
    note: 'Stem cuttings root fastest in warm weather.',
  };
  const pruneInWinter: SeasonalTask = {
    task: 'Prune',
    months: [1, 2],
    note: 'Before new growth starts.',
  };

  it('matches a task whose month list includes the current month', () => {
    const plant = makePlant({ id: 'p1', name: 'Fred', species: 'Pothos' });
    const tips = new Map([['Pothos', [propagateInSpring]]]);
    const entries = matchSeasonalTasks([plant], tips, undefined, onDate(3, 15));
    expect(entries).toEqual([
      { plantId: 'p1', plantName: 'Fred', task: 'Propagate', note: propagateInSpring.note },
    ]);
  });

  it('excludes a task whose month list does not include the current month', () => {
    const plant = makePlant({ id: 'p1', name: 'Fred', species: 'Pothos' });
    const tips = new Map([['Pothos', [propagateInSpring]]]);
    const entries = matchSeasonalTasks([plant], tips, undefined, onDate(7, 1));
    expect(entries).toHaveLength(0);
  });

  it('returns one entry per matching task, for plants with several', () => {
    const plant = makePlant({ id: 'p1', name: 'Fred', species: 'Pothos' });
    const tips = new Map([['Pothos', [propagateInSpring, pruneInWinter]]]);
    const entries = matchSeasonalTasks([plant], tips, undefined, onDate(3, 1));
    expect(entries.map((e) => e.task)).toEqual(['Propagate']);
  });

  it('shifts months for a Southern Hemisphere yard before matching', () => {
    const plant = makePlant({ id: 'p1', name: 'Fred', species: 'Pothos' });
    const tips = new Map([['Pothos', [propagateInSpring]]]);
    // Propagate is months [3,4,5] Northern-reference → [9,10,11] Southern.
    const northern = matchSeasonalTasks([plant], tips, 10, onDate(3, 15));
    const southern = matchSeasonalTasks([plant], tips, -33, onDate(3, 15));
    expect(northern).toHaveLength(1);
    expect(southern).toHaveLength(0);

    const southernInWindow = matchSeasonalTasks([plant], tips, -33, onDate(9, 15));
    expect(southernInWindow).toHaveLength(1);
  });

  it('falls back to the plant nickname when species is blank', () => {
    const plant = makePlant({ id: 'p1', name: 'My Basil' });
    const tips = new Map([['My Basil', [propagateInSpring]]]);
    const entries = matchSeasonalTasks([plant], tips, undefined, onDate(4, 1));
    expect(entries).toHaveLength(1);
  });

  it('skips plants whose species has no cached tips at all', () => {
    const plant = makePlant({ id: 'p1', name: 'Fred', species: 'Unknown Species' });
    const tips = new Map([['Pothos', [propagateInSpring]]]);
    const entries = matchSeasonalTasks([plant], tips, undefined, onDate(3, 15));
    expect(entries).toHaveLength(0);
  });
});
