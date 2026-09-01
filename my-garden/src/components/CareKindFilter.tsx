// src/components/CareKindFilter.tsx
// Toggleable chips ("💧 Water 12") for filtering due care items by kind.
// Shared between Due Today and the yard map's badges — lifted to App so
// picking "Water" here narrows both at once, not just the list.

import type { CareItem } from '../types';
import { KIND_ICONS, KIND_LABELS } from '../utils/careDisplay';

interface CareKindFilterProps {
  /** Kind -> how many due items of that kind exist right now. Kinds with 0 aren't shown. */
  counts: Partial<Record<CareItem['kind'], number>>;
  active: Set<CareItem['kind']>;
  onToggle: (kind: CareItem['kind']) => void;
  onClear: () => void;
}

const KIND_ORDER: CareItem['kind'][] = [
  'water', 'feed', 'prune', 'mulch', 'protect', 'inspect', 'other',
];

export function CareKindFilter({ counts, active, onToggle, onClear }: CareKindFilterProps) {
  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0);
  if (!kinds.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onClear}
        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
          active.size === 0
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        All
      </button>
      {kinds.map((kind) => {
        const isActive = active.has(kind);
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={isActive}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
              isActive
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>{KIND_ICONS[kind]}</span>
            {KIND_LABELS[kind]}
            <span className={isActive ? 'text-emerald-100' : 'text-gray-400'}>{counts[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}
