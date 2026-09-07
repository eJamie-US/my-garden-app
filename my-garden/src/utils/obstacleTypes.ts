// src/utils/obstacleTypes.ts
// Split out of YardObstaclesSettings.tsx so components that only need the
// plain-English label (RainStatus, PlantForm, PlantCareModal) don't pull
// that whole lazy-loaded settings screen back into the main bundle.

import type { YardObstacleType } from '../types';

export const TYPE_OPTIONS: { value: YardObstacleType; label: string; icon: string }[] = [
  { value: 'building', label: 'Building', icon: '🏠' },
  { value: 'covered-porch', label: 'Covered porch/roof', icon: '⛺' },
  { value: 'gazebo', label: 'Gazebo / carport / open picnic shelter', icon: '🏛️' },
  { value: 'shade-sail', label: 'Sun tarp / shade sail', icon: '⛱️' },
  { value: 'tree', label: 'Tree', icon: '🌳' },
  { value: 'fence', label: 'Fence', icon: '🚧' },
];

/** Reused wherever an obstacle needs a plain-English label outside
 *  YardObstaclesSettings.tsx — e.g. the rain-shelter readout on the plant form. */
export const OBSTACLE_TYPE_LABEL: Record<YardObstacleType, string> = Object.fromEntries(
  TYPE_OPTIONS.map((t) => [t.value, t.label]),
) as Record<YardObstacleType, string>;
