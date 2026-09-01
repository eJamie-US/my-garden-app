// src/utils/careDisplay.ts
// Small, shared formatting helpers for care items — used by Due Today, the
// per-plant care modal, and the due-badges on the yard markers, so all three
// agree on what "due" and "overdue" mean and look like.

import type { CareItem } from '../types';

export const KIND_ICONS: Record<CareItem['kind'], string> = {
  water: '💧', feed: '🌱', prune: '✂️', mulch: '🍂', protect: '🧣', inspect: '🔍', other: '📋',
};

export const KIND_LABELS: Record<CareItem['kind'], string> = {
  water: 'Water', feed: 'Feed', prune: 'Prune', mulch: 'Mulch',
  protect: 'Protect', inspect: 'Inspect', other: 'Other',
};

export const today = () => new Date().toISOString().slice(0, 10);

/** null = no due date set at all ("not scheduled"), distinct from 0 ("due today"). */
export function daysUntil(date?: string): number | null {
  if (!date) return null;
  const diff = new Date(date + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime();
  return Math.round(diff / 86_400_000);
}

export function dueLabel(days: number | null): string {
  if (days === null) return 'not scheduled';
  if (days < 0) return `overdue ${Math.abs(days)}d`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days}d`;
}

export function dueBadgeClass(days: number | null): string {
  if (days === null) return 'bg-gray-100 text-gray-500';
  if (days <= 0) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-50 text-emerald-700';
}

export function ingredientSummary(item: CareItem): string {
  if (!item.ingredients.length) return item.instructions ?? '';
  return item.ingredients
    .map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(' '))
    .join(' · ');
}
