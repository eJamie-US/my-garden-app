// src/components/DueToday.tsx
// Surfaces care_items whose next_due_date has arrived. Completing one rolls
// next_due_date forward by the item's own frequency, via the shared care
// items store — so the yard markers' due-badges and the care modal see the
// same change immediately.

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, CalendarDays } from 'lucide-react';
import type { CareItem, Plant } from '../types';
import { useCareItems } from '../hooks/useCareItems';
import { describeFrequency } from '../services/care/generateCareItems';
import { KIND_ICONS, ingredientSummary } from '../utils/careDisplay';

const today = () => new Date().toISOString().slice(0, 10);

/** Unlike the shared careDisplay helper, no due date here counts as "due now" — not "not scheduled" — so nothing gets lost from this list. */
function daysUntil(date?: string): number {
  if (!date) return 0;
  const diff = new Date(date + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime();
  return Math.round(diff / 86_400_000);
}

function dueLabel(days: number): string {
  if (days <= 0) return 'due today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

interface DueTodayProps {
  userId: string;
  plants: Plant[];
  onOpenPlant?: (plantId: string) => void;
}

export function DueToday({ userId, plants, onOpenPlant }: DueTodayProps) {
  const items = useCareItems((s) => s.items);
  const loading = useCareItems((s) => s.loading);
  const storeError = useCareItems((s) => s.error);
  const fetchForUser = useCareItems((s) => s.fetchForUser);
  const completeItem = useCareItems((s) => s.completeItem);

  const [completing, setCompleting] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');

  const plantNames = useMemo(
    () => new Map(plants.map((p) => [p.id, p.name])),
    [plants],
  );

  useEffect(() => {
    if (userId) void fetchForUser(userId);
  }, [userId, fetchForUser]);

  const due = items.filter((i) => daysUntil(i.nextDueDate) <= 0);
  const upcoming = items
    .filter((i) => daysUntil(i.nextDueDate) > 0)
    .sort((a, b) => daysUntil(a.nextDueDate) - daysUntil(b.nextDueDate));

  const complete = async (item: CareItem) => {
    setCompleting(item.id);
    setLocalError('');
    try {
      await completeItem(item);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setCompleting(null);
    }
  };

  const error = localError || storeError || '';

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-emerald-50 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-900">
          <CalendarDays size={15} /> Due today
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${
              due.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {due.length}
          </span>
        </h3>
        <span className="text-xs text-gray-400">
          {due.length ? 'Marking done rolls the next date forward' : 'All caught up'}
        </span>
      </div>

      {error && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" /> Loading your care plan…
        </p>
      ) : due.length ? (
        <ul>
          {due.map((item) => (
            <li key={item.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0">
              <span className="shrink-0 text-lg">{KIND_ICONS[item.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900">
                  {item.title}
                  {plantNames.has(item.plantId) && (
                    <span className="font-normal text-gray-500"> · {plantNames.get(item.plantId)}</span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500">{ingredientSummary(item)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                {describeFrequency(item.frequency)}
              </span>
              {onOpenPlant && (
                <button
                  type="button"
                  onClick={() => onOpenPlant(item.plantId)}
                  className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Open
                </button>
              )}
              <button
                type="button"
                disabled={completing === item.id}
                onClick={() => complete(item)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
              >
                {completing === item.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Done
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-xs text-gray-500">
          Nothing due today.{' '}
          {upcoming.length
            ? `Next up: ${upcoming[0].title} · ${dueLabel(daysUntil(upcoming[0].nextDueDate))}.`
            : 'Nothing scheduled yet.'}
        </p>
      )}
    </section>
  );
}
