// src/components/DueToday.tsx
// A compact "N due today" bar, always visible above the yard map. Clicking
// it opens a full-screen modal with two tabs: "Due today" (recurring,
// scheduled care — each plant with due items gets its own collapsible
// row, so the list stays scannable once a garden has dozens of plants
// instead of turning into one long flat feed) and "This month" (seasonal
// nudges — propagate, prune, repot, whatever genuinely applies — which
// have no due date and are never marked done, just recomputed fresh from
// plant-tips on every load). One entry point for "things to think about
// in the garden" instead of two separate always-visible bars competing
// for the same top-of-page space.
//
// Completing a due item rolls its next_due_date forward via the shared
// care items store, so this list, the yard markers' due-badges, and the
// care modal all see the same change immediately.
//
// The kind filter (water/feed/prune/…) is controlled from the parent so the
// same selection also narrows the yard map's badges, not just this list —
// it only applies to the "Due today" tab, since seasonal tasks aren't
// CareItems and have no kind.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, ChevronDown, ChevronRight, Loader2, CalendarDays, X } from 'lucide-react';
import type { CareItem, Plant, Yard } from '../types';
import type { Plan } from '../services/supabase/billing';
import { useCareItems } from '../hooks/useCareItems';
import { useSeasonalTasks } from '../hooks/useSeasonalTasks';
import { useToast } from '../hooks/useToast';
import { describeFrequency } from '../services/care/generateCareItems';
import { KIND_ICONS, kindLabel, ingredientSummary } from '../utils/careDisplay';
import { CareKindFilter } from './CareKindFilter';
import { CompleteWithDateMenu } from './CompleteWithDateMenu';

const today = () => new Date().toISOString().slice(0, 10);

/** Unlike the shared careDisplay helper, no due date here counts as "due now" — not "not scheduled" — so nothing gets lost from this list. */
function daysUntil(date?: string): number {
  if (!date) return 0;
  const diff = new Date(date + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime();
  return Math.round(diff / 86_400_000);
}

function dueLabel(t: TFunction, days: number): string {
  if (days <= 0) return t('dueToday.dueLabelToday');
  if (days === 1) return t('dueToday.dueLabelTomorrow');
  return t('dueToday.dueLabelInDays', { count: days });
}

interface DueTodayProps {
  userId: string;
  plants: Plant[];
  garden: Yard | null;
  plan: Plan;
  onOpenPlant?: (plantId: string) => void;
  kindFilter: Set<CareItem['kind']>;
  onKindFilterChange: (next: Set<CareItem['kind']>) => void;
}

export function DueToday({
  userId, plants, garden, plan, onOpenPlant, kindFilter, onKindFilterChange,
}: DueTodayProps) {
  const { t } = useTranslation();
  const items = useCareItems((s) => s.items);
  const loading = useCareItems((s) => s.loading);
  const storeError = useCareItems((s) => s.error);
  const fetchForUser = useCareItems((s) => s.fetchForUser);
  const completeItem = useCareItems((s) => s.completeItem);
  const completeMany = useCareItems((s) => s.completeMany);
  const undoLastCompletion = useCareItems((s) => s.undoLastCompletion);
  const showToast = useToast((s) => s.show);
  const { entries: seasonalEntries, byPlant: seasonalByPlant } = useSeasonalTasks(plants, garden, plan);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'due' | 'seasonal'>('due');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<string | null>(null);
  const [completingAll, setCompletingAll] = useState(false);
  const [localError, setLocalError] = useState('');

  const plantNames = new Map(plants.map((p) => [p.id, p.name]));

  useEffect(() => {
    if (userId) void fetchForUser(userId);
  }, [userId, fetchForUser]);

  const allDue = items.filter((i) => daysUntil(i.nextDueDate) <= 0);
  const due = kindFilter.size ? allDue.filter((i) => kindFilter.has(i.kind)) : allDue;
  const upcoming = items
    .filter((i) => daysUntil(i.nextDueDate) > 0)
    .sort((a, b) => daysUntil(a.nextDueDate) - daysUntil(b.nextDueDate));

  // Counts reflect every due item regardless of the current filter, so
  // toggling a second kind on doesn't make the chip you're about to click
  // vanish or misreport how many items it actually covers.
  const kindCounts: Partial<Record<CareItem['kind'], number>> = {};
  for (const item of allDue) kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;

  const toggleKind = (kind: CareItem['kind']) => {
    const next = new Set(kindFilter);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onKindFilterChange(next);
  };
  const clearKindFilter = () => onKindFilterChange(new Set());

  // Grouped by plant so a garden with dozens of plants reads as a short
  // list of plants to go check on, not a wall of individual chores. Plants
  // are ordered by their own most-overdue item.
  const byPlant = new Map<string, CareItem[]>();
  for (const item of due) {
    const list = byPlant.get(item.plantId) ?? [];
    list.push(item);
    byPlant.set(item.plantId, list);
  }
  for (const list of byPlant.values()) {
    list.sort((a, b) => daysUntil(a.nextDueDate) - daysUntil(b.nextDueDate));
  }
  const duesByPlant = [...byPlant.entries()].sort(
    ([, a], [, b]) => daysUntil(a[0].nextDueDate) - daysUntil(b[0].nextDueDate),
  );

  const toggleExpanded = (plantId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(plantId)) next.delete(plantId);
      else next.add(plantId);
      return next;
    });

  const complete = async (item: CareItem, when?: Date) => {
    setCompleting(item.id);
    setLocalError('');
    try {
      await completeItem(item, when);
      showToast({
        message: t('dueToday.completedToast', { title: item.title }),
        actionLabel: t('common.undo'),
        onAction: () => {
          undoLastCompletion(item.id).catch((err) => {
            setLocalError(err instanceof Error ? err.message : t('common.saveError'));
          });
        },
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('common.saveError'));
    } finally {
      setCompleting(null);
    }
  };

  const completeAllVisible = async () => {
    setCompletingAll(true);
    setLocalError('');
    try {
      const completedItems = due;
      await completeMany(completedItems);
      showToast({
        message: t('dueToday.completedAllToast', { count: completedItems.length }),
        actionLabel: t('common.undo'),
        onAction: () => {
          Promise.all(completedItems.map((item) => undoLastCompletion(item.id))).catch((err) => {
            setLocalError(err instanceof Error ? err.message : t('common.saveError'));
          });
        },
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('dueToday.completeAllError'));
    } finally {
      setCompletingAll(false);
    }
  };

  const error = localError || storeError || '';
  const filterLabel = [...kindFilter].map((k) => kindLabel(t, k)).join(', ');

  return (
    <>
      <div className="mx-auto w-full max-w-5xl space-y-2 px-4 pt-4">
        <button
          type="button"
          onClick={() => {
            // Land on whichever tab actually has something to show — no
            // point opening to an empty Due Today when the only thing
            // worth seeing today is a seasonal nudge.
            setTab(due.length === 0 && seasonalEntries.length > 0 ? 'seasonal' : 'due');
            setOpen(true);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3 text-left shadow-sm hover:border-emerald-200"
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays size={16} className="shrink-0 text-emerald-700" />
            <span className="shrink-0 text-sm font-bold text-emerald-900">{t('dueToday.title')}</span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                due.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {due.length}
            </span>
            {seasonalEntries.length > 0 && (
              <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-800">
                {seasonalEntries.length}
              </span>
            )}
            <span className="min-w-0 truncate text-xs text-gray-400">
              {loading
                ? t('dueToday.loadingCarePlan')
                : kindFilter.size
                  ? t('dueToday.filteredAcrossPlants', { filter: filterLabel, count: duesByPlant.length })
                  : due.length
                    ? t('dueToday.acrossPlants', { count: duesByPlant.length })
                    : seasonalEntries.length
                      ? t('dueToday.allCaughtUpSeasonal', { count: seasonalEntries.length })
                      : upcoming.length
                        ? t('dueToday.allCaughtUpNext', {
                            title: upcoming[0].title,
                            when: dueLabel(t, daysUntil(upcoming[0].nextDueDate)),
                          })
                        : t('dueToday.allCaughtUp')}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-gray-400" />
        </button>

        <CareKindFilter
          counts={kindCounts}
          active={kindFilter}
          onToggle={toggleKind}
          onClear={clearKindFilter}
        />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <CalendarDays size={18} className="text-emerald-700" />
                {tab === 'due' ? t('dueToday.title') : t('dueToday.seasonalTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 text-gray-500 hover:text-gray-700"
                aria-label={tab === 'due' ? t('dueToday.close') : t('dueToday.closeSeasonalTasks')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex shrink-0 gap-2 border-b bg-gray-50 px-4 pt-2.5">
              <button
                type="button"
                onClick={() => setTab('due')}
                className={`rounded-t-md border-b-2 px-3 py-1.5 text-xs font-semibold ${
                  tab === 'due'
                    ? 'border-emerald-600 text-emerald-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('dueToday.tabDue', { count: due.length })}
              </button>
              <button
                type="button"
                onClick={() => setTab('seasonal')}
                className={`rounded-t-md border-b-2 px-3 py-1.5 text-xs font-semibold ${
                  tab === 'seasonal'
                    ? 'border-violet-600 text-violet-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('dueToday.tabSeasonal', { count: seasonalEntries.length })}
              </button>
            </div>

            {tab === 'due' && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-gray-50 px-4 py-2.5">
              <CareKindFilter
                counts={kindCounts}
                active={kindFilter}
                onToggle={toggleKind}
                onClear={clearKindFilter}
              />
              {kindFilter.size > 0 && due.length > 0 && (
                <button
                  type="button"
                  disabled={completingAll}
                  onClick={completeAllVisible}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                >
                  {completingAll ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {t('dueToday.markAllDone', { filter: filterLabel.toLowerCase(), count: due.length })}
                </button>
              )}
            </div>
            )}

            {tab === 'due' && error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === 'seasonal' ? (
                seasonalByPlant.length ? (
                  <ul className="space-y-2">
                    {seasonalByPlant.map(([plantId, plantEntries]) => {
                      const isOpen = expanded.has(plantId);
                      return (
                        <li key={plantId} className="overflow-hidden rounded-lg border border-gray-200">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(plantId)}
                            aria-expanded={isOpen}
                            className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2.5 text-left hover:bg-gray-100"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <ChevronDown
                                size={14}
                                className={`shrink-0 text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                              />
                              <span className="truncate text-sm font-semibold text-gray-900">
                                {plantEntries[0].plantName}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-800">
                              {plantEntries.length}
                            </span>
                          </button>

                          {isOpen && (
                            <ul>
                              {plantEntries.map((e, i) => (
                                <li
                                  key={`${e.task}-${i}`}
                                  className="flex items-center gap-3 border-t border-gray-100 px-3 py-2.5"
                                >
                                  <span className="shrink-0 text-lg">📅</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-gray-900">{e.task}</span>
                                    {e.note && (
                                      <span className="block truncate text-xs text-gray-500">{e.note}</span>
                                    )}
                                  </span>
                                  {onOpenPlant && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onOpenPlant(e.plantId);
                                        setOpen(false);
                                      }}
                                      className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                      {t('dueToday.open')}
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-4 text-xs text-gray-500">{t('dueToday.nothingSeasonal')}</p>
                )
              ) : loading ? (
                <p className="flex items-center gap-2 py-4 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" /> {t('dueToday.loadingCarePlan')}
                </p>
              ) : duesByPlant.length ? (
                <ul className="space-y-2">
                  {duesByPlant.map(([plantId, plantItems]) => {
                    const isOpen = expanded.has(plantId);
                    return (
                      <li key={plantId} className="overflow-hidden rounded-lg border border-gray-200">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(plantId)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2.5 text-left hover:bg-gray-100"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ChevronDown
                              size={14}
                              className={`shrink-0 text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                            />
                            <span className="truncate text-sm font-semibold text-gray-900">
                              {plantNames.get(plantId) ?? t('dueToday.unknownPlant')}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
                            {plantItems.length}
                          </span>
                        </button>

                        {isOpen && (
                          <ul>
                            {plantItems.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center gap-3 border-t border-gray-100 px-3 py-2.5"
                              >
                                <span className="shrink-0 text-lg">{KIND_ICONS[item.kind]}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-gray-900">
                                    {item.title}
                                  </span>
                                  <span className="block truncate text-xs text-gray-500">
                                    {ingredientSummary(item)}
                                  </span>
                                </span>
                                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                                  {describeFrequency(item.frequency)}
                                </span>
                                {onOpenPlant && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onOpenPlant(item.plantId);
                                      setOpen(false);
                                    }}
                                    className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                  >
                                    {t('dueToday.open')}
                                  </button>
                                )}
                                <CompleteWithDateMenu
                                  disabled={completing === item.id}
                                  onComplete={(when) => complete(item, when)}
                                  wrapperClassName="shrink-0 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 has-[:disabled]:bg-gray-400"
                                  mainButtonClassName="flex items-center gap-1 rounded-l-md px-3 py-1 text-xs font-semibold"
                                >
                                  {completing === item.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Check size={12} />
                                  )}
                                  {t('dueToday.done')}
                                </CompleteWithDateMenu>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : kindFilter.size ? (
                <p className="py-4 text-xs text-gray-500">
                  {t('dueToday.nothingDueForFilter', { filter: filterLabel.toLowerCase() })}
                </p>
              ) : (
                <p className="py-4 text-xs text-gray-500">
                  {t('dueToday.nothingDueToday')}{' '}
                  {upcoming.length
                    ? t('dueToday.nextUp', {
                        title: upcoming[0].title,
                        plant: plantNames.get(upcoming[0].plantId) ?? '',
                        when: dueLabel(t, daysUntil(upcoming[0].nextDueDate)),
                      })
                    : t('dueToday.nothingScheduledYet')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
