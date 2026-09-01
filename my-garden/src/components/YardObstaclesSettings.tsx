// src/components/YardObstaclesSettings.tsx
// Mark roughly where buildings, covered porches, trees and fences sit in
// the yard photo — click a spot, pick a type and a rough height. Feeds the
// sun/shade exposure estimate (see utils/sunExposure.ts); position only
// needs to be approximate, same as everything else that estimate does.

import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { yardObstaclesService } from '../services/supabase/yardObstacles';
import type { ObstacleHeightTier, YardObstacle, YardObstacleType } from '../types';

const TYPE_OPTIONS: { value: YardObstacleType; label: string; icon: string }[] = [
  { value: 'building', label: 'Building', icon: '🏠' },
  { value: 'covered-porch', label: 'Covered porch/roof', icon: '⛺' },
  { value: 'tree', label: 'Tree', icon: '🌳' },
  { value: 'fence', label: 'Fence', icon: '🚧' },
];

const TIER_OPTIONS: { value: ObstacleHeightTier; label: string }[] = [
  { value: 'low', label: 'Low (~fence height)' },
  { value: 'medium', label: 'Medium (~single-story roof)' },
  { value: 'tall', label: 'Tall (~tree or two-story)' },
];

const ICON_BY_TYPE: Record<YardObstacleType, string> = {
  building: '🏠',
  'covered-porch': '⛺',
  tree: '🌳',
  fence: '🚧',
};

interface YardObstaclesSettingsProps {
  userId: string;
  yardImageUrl: string;
  obstacles: YardObstacle[];
  onSaved: (obstacles: YardObstacle[]) => void;
  onClose: () => void;
}

export function YardObstaclesSettings({
  userId,
  yardImageUrl,
  obstacles,
  onSaved,
  onClose,
}: YardObstaclesSettingsProps) {
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [type, setType] = useState<YardObstacleType>('tree');
  const [heightTier, setHeightTier] = useState<ObstacleHeightTier>('medium');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setPending({ x, y });
    // 'covered-porch' is nearly always closer to 'medium' than 'tall' — a
    // reasonable default, still overridable before adding.
    setHeightTier(type === 'covered-porch' ? 'medium' : heightTier);
    setError('');
  };

  const addObstacle = async () => {
    if (!pending) return;
    setSaving(true);
    setError('');
    try {
      const created = await yardObstaclesService.create(userId, {
        type,
        location: pending,
        heightTier,
      });
      onSaved([...obstacles, created]);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that obstacle');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (obstacle: YardObstacle) => {
    setRemovingId(obstacle.id);
    setError('');
    try {
      await yardObstaclesService.remove(obstacle.id);
      onSaved(obstacles.filter((o) => o.id !== obstacle.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that obstacle');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Yard obstacles</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close yard obstacles"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            Click a spot on the yard for anything that blocks the sun — the house, a covered
            porch, trees, fences. Rough position and height are all the sun/shade estimate needs.
          </p>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          <div
            onClick={handleImageClick}
            className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-gray-200"
          >
            <img src={yardImageUrl} alt="Your yard" className="block h-auto w-full select-none" draggable={false} />
            {obstacles.map((o) => (
              <span
                key={o.id}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm shadow ring-1 ring-gray-300"
                style={{ left: `${o.location.x}%`, top: `${o.location.y}%` }}
                title={`${o.label || TYPE_OPTIONS.find((t) => t.value === o.type)?.label} (${o.heightTier})`}
              >
                {ICON_BY_TYPE[o.type]}
              </span>
            ))}
            {pending && (
              <span
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse items-center justify-center rounded-full bg-emerald-500 text-sm text-white shadow ring-2 ring-white"
                style={{ left: `${pending.x}%`, top: `${pending.y}%` }}
              >
                {ICON_BY_TYPE[type]}
              </span>
            )}
          </div>

          {pending && (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex gap-2">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as YardObstacleType)}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <select
                  value={heightTier}
                  onChange={(e) => setHeightTier(e.target.value as ObstacleHeightTier)}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addObstacle}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          )}

          {obstacles.length > 0 && (
            <ul className="divide-y rounded-lg border border-gray-200">
              {obstacles.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-base">{ICON_BY_TYPE[o.type]}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-700">
                    {o.label || TYPE_OPTIONS.find((t) => t.value === o.type)?.label}
                    <span className="text-gray-400"> · {o.heightTier}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(o)}
                    disabled={removingId === o.id}
                    aria-label="Remove obstacle"
                    className="shrink-0 p-1 text-gray-400 hover:text-red-600"
                  >
                    {removingId === o.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
