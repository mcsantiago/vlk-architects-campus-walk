import type { AssetCategoryView } from '@campus-walk/shared';
import type { CSSProperties } from 'react';
import { useAssetCategories } from '../api/queries';

/** A category's display name, or its key while the list loads or if the row is gone. */
export const categoryName = (categories: AssetCategoryView[] | undefined, key: string) =>
  categories?.find((c) => c.key === key)?.name ?? key;

/**
 * Categories in their stored order, plus any key the assets use that the list does not have
 * (so nothing is dropped from a listing if a category row is missing or still loading).
 */
export function orderedCategories(categories: AssetCategoryView[] | undefined, used: string[]): { key: string; name: string }[] {
  const known = categories ?? [];
  const extra = [...new Set(used)].filter((k) => !known.some((c) => c.key === k)).sort();
  return [...known.map((c) => ({ key: c.key, name: c.name })), ...extra.map((key) => ({ key, name: key }))];
}

/** The category pill, coloured from the asset_category row; neutral grey until the list has loaded. */
export function CategoryBadge({ category, label, style }: { category: string; label?: string; style?: CSSProperties }) {
  const categories = useAssetCategories();
  const row = categories.data?.find((c) => c.key === category);
  return (
    <span className="badge cat" style={{ ...(row && ({ '--cat': row.color } as CSSProperties)), ...style }}>
      {label ?? row?.name ?? category}
    </span>
  );
}
