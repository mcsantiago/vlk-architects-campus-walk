import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { CreateAssetTypeInput, UpdateAssetTypeInput } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';

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

/**
 * Category is a property of the type, so moving "Projector" from equipment to technology moves
 * every projector at once, in every listing and roll-up. Switching a counted type to one-per-unit
 * is refused while records with a quantity above 1 exist, since they could no longer be saved.
 */
export async function updateAssetType(db: Db, id: string, input: UpdateAssetTypeInput) {
  const [existing] = await db.select().from(s.assetType).where(eq(s.assetType.id, id));
  if (!existing) throw notFound('asset type');
  if (input.trackedIndividually && !existing.trackedIndividually) {
    const [counted] = await db
      .select({ id: s.asset.id })
      .from(s.asset)
      .where(and(eq(s.asset.assetTypeId, id), gt(s.asset.quantity, 1), isNull(s.asset.deletedAt)))
      .limit(1);
    if (counted) throw badRequest(`${existing.name} has records with a quantity above 1; split them before tracking it per unit`);
  }
  const [updated] = await db
    .update(s.assetType)
    .set({
      ...(input.category !== undefined && { category: input.category }),
      ...(input.trackedIndividually !== undefined && { trackedIndividually: input.trackedIndividually }),
    })
    .where(eq(s.assetType.id, id))
    .returning();
  return updated!;
}
