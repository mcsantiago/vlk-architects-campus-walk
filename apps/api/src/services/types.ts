import { sql } from 'drizzle-orm';
import type { CreateAssetTypeInput } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';

export function listAssetTypes(db: Db) {
  return db.select().from(s.assetType).orderBy(s.assetType.category, s.assetType.name);
}

async function findByName(db: Db, name: string) {
  const [type] = await db.select().from(s.assetType).where(sql`lower(${s.assetType.name}) = lower(${name})`);
  return type ?? null;
}

/**
 * The catalogue grows from the field: a walker who meets something new adds it once and every
 * walker sees it from then on. Matching is case-insensitive so "kiln" does not fork "Kiln";
 * when the name exists its category and tracking are kept, not overwritten.
 */
export async function findOrCreateAssetType(db: Db, input: CreateAssetTypeInput) {
  const existing = await findByName(db, input.name);
  if (existing) return existing;
  await db.insert(s.assetType).values(input).onConflictDoNothing();
  return (await findByName(db, input.name))!;
}
