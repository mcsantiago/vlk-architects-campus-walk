/**
 * Condition scale used across the field app, API and summary.
 * Kept deliberately coarse: a walker should be able to pick one in under a second.
 */
export const CONDITIONS = [
  { value: 5, label: 'Excellent' },
  { value: 4, label: 'Good' },
  { value: 3, label: 'Fair' },
  { value: 2, label: 'Poor' },
  { value: 1, label: 'Critical' },
] as const;

export type Condition = (typeof CONDITIONS)[number]['value'];

/** Assets at or below this rating show up in the office "poor condition" list. */
export const POOR_CONDITION_MAX = 2;

export const ASSET_CATEGORIES = ['furniture', 'equipment', 'system'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ROOM_TYPES = [
  'classroom',
  'lab',
  'library',
  'office',
  'gym',
  'cafeteria',
  'kitchen',
  'restroom',
  'storage',
  'mechanical',
  'corridor',
  'other',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export function conditionLabel(value: number): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? 'Unknown';
}
