// src/utils/obstacleTypes.ts
// Split out of YardObstaclesSettings.tsx so components that only need the
// label (RainStatus, PlantForm, PlantCareModal) don't pull that whole
// lazy-loaded settings screen back into the main bundle.

import type { TFunction } from 'i18next';
import type { YardObstacleType } from '../types';

const TYPE_ICON: Record<YardObstacleType, string> = {
  building: '🏠',
  'covered-porch': '⛺',
  gazebo: '🏛️',
  'shade-sail': '⛱️',
  tree: '🌳',
  fence: '🚧',
};

const TYPE_KEY: Record<YardObstacleType, string> = {
  building: 'building',
  'covered-porch': 'coveredPorch',
  gazebo: 'gazebo',
  'shade-sail': 'shadeSail',
  tree: 'tree',
  fence: 'fence',
};

const TYPE_ORDER: YardObstacleType[] = [
  'building', 'covered-porch', 'gazebo', 'shade-sail', 'tree', 'fence',
];

/** `t` comes from the caller's own useTranslation() — this file has no
 *  component of its own to call it from. */
export function typeOptions(t: TFunction): { value: YardObstacleType; label: string; icon: string }[] {
  return TYPE_ORDER.map((value) => ({
    value,
    label: t(`obstacleType.${TYPE_KEY[value]}`),
    icon: TYPE_ICON[value],
  }));
}

/** Reused wherever an obstacle needs a label outside YardObstaclesSettings.tsx
 *  — e.g. the rain-shelter readout on the plant form. */
export function obstacleTypeLabel(t: TFunction, type: YardObstacleType): string {
  return t(`obstacleType.${TYPE_KEY[type]}`);
}
