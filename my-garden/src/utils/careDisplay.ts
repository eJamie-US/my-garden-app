// src/utils/careDisplay.ts
// Small, shared formatting helpers for care items — used by Due Today, the
// per-plant care modal, and the due-badges on the yard markers, so all three
// agree on what "due" and "overdue" mean and look like.

import type { TFunction } from 'i18next';
import type { CareItem, Plant } from '../types';

export const KIND_ICONS: Record<CareItem['kind'], string> = {
  water: '💧', feed: '🌱', prune: '✂️', mulch: '🍂', protect: '🧣', inspect: '🔍', other: '📋',
};

/** `t` comes from the caller's own useTranslation() — this file has no
 *  component/hook of its own to call it from. */
export function kindLabel(t: TFunction, kind: CareItem['kind']): string {
  return t(`careKind.${kind}`);
}

/** The plant name field is optional (added a plant without naming it yet,
 *  planning to fill it in once identified) — display spots use this instead
 *  of `plant.name` directly so a blank name shows "Unnamed plant" rather
 *  than an empty label. Matching logic (care-profile lookup, AI species
 *  keys) reads `plant.name` directly instead, since those want to know
 *  whether anything was actually specified, not a display fallback. */
export function plantDisplayName(t: TFunction, plant: Pick<Plant, 'name'>): string {
  return plant.name.trim() || t('common.unnamedPlant');
}

export const today = () => new Date().toISOString().slice(0, 10);

/** null = no due date set at all ("not scheduled"), distinct from 0 ("due today"). */
export function daysUntil(date?: string): number | null {
  if (!date) return null;
  const diff = new Date(date + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime();
  return Math.round(diff / 86_400_000);
}

export function dueLabel(t: TFunction, days: number | null): string {
  if (days === null) return t('careDisplay.notScheduled');
  if (days < 0) return t('careDisplay.overdue', { count: Math.abs(days) });
  if (days === 0) return t('careDisplay.dueToday');
  if (days === 1) return t('careDisplay.dueTomorrow');
  return t('careDisplay.dueInDays', { count: days });
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
