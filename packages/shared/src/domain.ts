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

/**
 * A category's key, e.g. "technology". The list itself lives in the asset_category table
 * (GET /asset-categories); nothing in code depends on which categories exist.
 */
export type AssetCategory = string;

/**
 * Room type is free text: it comes from the district's floor plan or inventory and is only ever
 * shown, never branched on, so a "Band Hall" or "Training Room" needs no code change. These are
 * the examples the import template documents and the seed uses.
 */
export const ROOM_TYPE_EXAMPLES = [
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
export type RoomType = string;

/** Null is an asset that is on the books but has not been rated on a walk yet. */
export const NOT_RATED = 'Not rated';

export function conditionLabel(value: number | null): string {
  if (value === null) return NOT_RATED;
  return CONDITIONS.find((c) => c.value === value)?.label ?? 'Unknown';
}
