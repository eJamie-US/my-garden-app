// src/components/CareItemsEditor.tsx
// Fully editable care list: title, frequency, next due date, and ingredients
// with amount + unit. Whether an item came from the weather-driven generator
// or was typed in by hand, every field here stays editable.

import { Plus, Trash2, GripVertical, Sparkles } from 'lucide-react';
import { CARE_UNITS } from '../types';
import { today } from '../utils/careDisplay';
import type {
  CareFrequencyUnit,
  CareIngredient,
  CareItemKind,
  DraftCareItem,
} from '../types';

const KIND_ICONS: Record<CareItemKind, string> = {
  water: '💧',
  feed: '🌱',
  prune: '✂️',
  mulch: '🍂',
  protect: '🧣',
  inspect: '🔍',
  other: '📋',
};

const KINDS: CareItemKind[] = [
  'water', 'feed', 'prune', 'mulch', 'protect', 'inspect', 'other',
];

const FREQUENCY_UNITS: CareFrequencyUnit[] = ['day', 'week', 'month', 'year'];

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

interface CareItemsEditorProps {
  items: DraftCareItem[];
  onChange: (items: DraftCareItem[]) => void;
  /** Shown above the list: why the generator chose these frequencies. */
  rationale?: string[];
  weatherUsed?: boolean;
  onRegenerate?: () => void;
}

export function CareItemsEditor({
  items,
  onChange,
  rationale = [],
  weatherUsed = true,
  onRegenerate,
}: CareItemsEditorProps) {
  const patch = (id: string, updates: Partial<DraftCareItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...updates } : i)));

  const patchIngredient = (
    itemId: string,
    ingredientId: string,
    updates: Partial<CareIngredient>,
  ) =>
    onChange(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ingredients: item.ingredients.map((ing) =>
                ing.id === ingredientId ? { ...ing, ...updates } : ing,
              ),
            }
          : item,
      ),
    );

  const addIngredient = (itemId: string) =>
    onChange(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ingredients: [
                ...item.ingredients,
                { id: uid('ing'), name: '', amount: '', unit: '' as const },
              ],
            }
          : item,
      ),
    );

  const removeIngredient = (itemId: string, ingredientId: string) =>
    onChange(
      items.map((item) =>
        item.id === itemId
          ? { ...item, ingredients: item.ingredients.filter((i) => i.id !== ingredientId) }
          : item,
      ),
    );

  const addItem = () =>
    onChange([
      ...items,
      {
        id: uid('care'),
        title: '',
        kind: 'other',
        frequency: { every: 1, unit: 'week' },
        nextDueDate: today(),
        ingredients: [],
        instructions: '',
        source: 'user',
      },
    ]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">
          Care plan
          <span className="ml-1.5 font-normal text-gray-400">({items.length})</span>
        </h4>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
          >
            <Sparkles size={12} /> Regenerate
          </button>
        )}
      </div>

      {!weatherUsed && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Local weather unavailable — these are generic baselines. Adjust anything
          that looks wrong for your patch.
        </p>
      )}

      {rationale.length > 0 && (
        <ul className="space-y-0.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
          {rationale.map((line) => (
            <li key={line} className="text-xs leading-snug text-emerald-900">
              {line}
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
            <div className="flex items-start gap-2">
              <GripVertical size={14} className="mt-2 shrink-0 text-gray-300" />

              <select
                value={item.kind}
                onChange={(e) => patch(item.id, { kind: e.target.value as CareItemKind })}
                aria-label="Care type"
                className="mt-0.5 shrink-0 rounded border border-gray-200 bg-gray-50 px-1 py-1 text-base"
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_ICONS[kind]}
                  </option>
                ))}
              </select>

              <div className="min-w-0 flex-1 space-y-2">
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => patch(item.id, { title: e.target.value })}
                  placeholder="What needs doing"
                  className="w-full border-b border-transparent px-0 py-0.5 text-sm font-semibold text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                  <span>every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={item.frequency.every}
                    onChange={(e) =>
                      patch(item.id, {
                        frequency: {
                          ...item.frequency,
                          every: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    aria-label="Frequency interval"
                    className="w-12 rounded border border-gray-300 px-1.5 py-1 text-center"
                  />
                  <select
                    value={item.frequency.unit}
                    onChange={(e) =>
                      patch(item.id, {
                        frequency: {
                          ...item.frequency,
                          unit: e.target.value as CareFrequencyUnit,
                        },
                      })
                    }
                    aria-label="Frequency unit"
                    className="rounded border border-gray-300 px-1.5 py-1"
                  >
                    {FREQUENCY_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}{item.frequency.every > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>

                  <span className="ml-2 shrink-0">next due</span>
                  <input
                    type="date"
                    value={item.nextDueDate ?? ''}
                    onChange={(e) => patch(item.id, { nextDueDate: e.target.value || undefined })}
                    aria-label="Next due date"
                    className="rounded border border-gray-300 px-1.5 py-1"
                  />

                  {item.source === 'generated' && (
                    <span className="ml-auto rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      suggested
                    </span>
                  )}
                </div>

                {item.ingredients.length > 0 && (
                  <ul className="space-y-1">
                    {item.ingredients.map((ing) => (
                      <li key={ing.id} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ing.amount}
                          onChange={(e) =>
                            patchIngredient(item.id, ing.id, { amount: e.target.value })
                          }
                          placeholder="1/2"
                          aria-label="Amount"
                          className="w-14 rounded border border-gray-300 px-1.5 py-1 text-center text-xs"
                        />
                        <select
                          value={ing.unit}
                          onChange={(e) =>
                            patchIngredient(item.id, ing.id, {
                              unit: e.target.value as CareIngredient['unit'],
                            })
                          }
                          aria-label="Unit"
                          className="w-[74px] shrink-0 rounded border border-gray-300 px-1 py-1 text-xs"
                        >
                          <option value="">unit</option>
                          {CARE_UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={ing.name}
                          onChange={(e) =>
                            patchIngredient(item.id, ing.id, { name: e.target.value })
                          }
                          placeholder="Ingredient"
                          aria-label="Ingredient"
                          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => removeIngredient(item.id, ing.id)}
                          aria-label={`Remove ${ing.name || 'ingredient'}`}
                          className="shrink-0 p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => addIngredient(item.id)}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    <Plus size={12} /> Ingredient
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                  >
                    <Trash2 size={12} /> Remove item
                  </button>
                </div>

                <textarea
                  value={item.instructions ?? ''}
                  onChange={(e) => patch(item.id, { instructions: e.target.value })}
                  rows={2}
                  placeholder="Notes (optional)"
                  className="w-full resize-none rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 placeholder-gray-400"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addItem}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-300 py-2 text-xs font-semibold text-gray-600 hover:border-emerald-400 hover:text-emerald-700"
      >
        <Plus size={14} /> Add a care item
      </button>
    </div>
  );
}
