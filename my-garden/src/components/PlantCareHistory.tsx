// src/components/PlantCareHistory.tsx
// A plant's past care completions, newest first. Only the most recent
// completion of each distinct care item can still be undone — undoing an
// older one would desync the due-date chain for anything completed after
// it (see migration 031's undo_last_completion). That's computed here
// client-side from the already newest-first list: the first row seen for a
// given care_item_id is that item's undoable one.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Undo2 } from 'lucide-react';
import type { CareCompletion } from '../types';
import { careCompletionsService } from '../services/supabase/careCompletions';
import { KIND_ICONS } from '../utils/careDisplay';

interface PlantCareHistoryProps {
  plantId: string;
  /** Bump to force a refetch after a complete/undo elsewhere in the modal. */
  refreshKey?: number;
  onUndo: (careItemId: string) => Promise<void>;
}

export function PlantCareHistory({ plantId, refreshKey = 0, onUndo }: PlantCareHistoryProps) {
  const { t, i18n } = useTranslation();
  const [completions, setCompletions] = useState<CareCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await careCompletionsService.getForPlant(plantId);
      setCompletions(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plantCareHistory.loadError'));
    } finally {
      setLoading(false);
    }
  }, [plantId, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleUndo = async (completion: CareCompletion) => {
    setUndoing(completion.id);
    setError('');
    try {
      await onUndo(completion.careItemId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plantCareHistory.undoError'));
    } finally {
      setUndoing(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> {t('plantCareHistory.loading')}
      </p>
    );
  }

  if (!completions.length) {
    return <p className="py-2 text-xs text-gray-500">{t('plantCareHistory.empty')}</p>;
  }

  const seenItemIds = new Set<string>();

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {completions.map((completion) => {
          const isLatestForItem = !seenItemIds.has(completion.careItemId);
          seenItemIds.add(completion.careItemId);

          return (
            <li
              key={completion.id}
              className="flex items-center gap-2.5 rounded-lg border border-gray-200 p-2"
            >
              <span className="shrink-0 text-base">{KIND_ICONS[completion.itemKind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-900">
                  {completion.itemTitle}
                </span>
                <span className="block text-[11px] text-gray-500">
                  {new Date(completion.completedAt).toLocaleDateString(i18n.language, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </span>
              {isLatestForItem && (
                <button
                  type="button"
                  disabled={undoing === completion.id}
                  onClick={() => handleUndo(completion)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {undoing === completion.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Undo2 size={11} />
                  )}
                  {t('plantCareHistory.undo')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
