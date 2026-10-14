import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { CopyAssetInput, CreateAssetInput, MoveAssetInput, UpdateAssetInput } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { resolveLocation, type Location } from './location.ts';
import { attachPhotos } from './photos.ts';

/** The asset shape every endpoint returns: the row plus its type, minus bookkeeping columns. */
export const assetView = {
  id: s.asset.id,
  buildingId: s.asset.buildingId,
  floorId: s.asset.floorId,
  roomId: s.asset.roomId,
  label: s.asset.label,
  quantity: s.asset.quantity,
  condition: s.asset.condition,
  notes: s.asset.notes,
  manufacturer: s.asset.manufacturer,
  model: s.asset.model,
  serialNumber: s.asset.serialNumber,
  installYear: s.asset.installYear,
  version: s.asset.version,
  createdAt: s.asset.createdAt,
  updatedAt: s.asset.updatedAt,
  assetType: {
    id: s.assetType.id,
    name: s.assetType.name,
    category: s.assetType.category,
    trackedIndividually: s.assetType.trackedIndividually,
  },
};

export const liveAssets = isNull(s.asset.deletedAt);

export async function listAssets(db: Db, where?: SQL) {
  return db
    .select(assetView)
    .from(s.asset)
    .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
    .where(and(liveAssets, where))
    .orderBy(s.assetType.category, s.assetType.name, s.asset.label, s.asset.createdAt);
}
export type AssetView = Awaited<ReturnType<typeof listAssets>>[number];

export async function getAsset(db: Db, id: string): Promise<AssetView | null> {
  const [asset] = await listAssets(db, eq(s.asset.id, id));
  return asset ?? null;
}

export function listAssetEvents(db: Db, assetId: string) {
  return db
    .select({
      id: s.assetEvent.id,
      kind: s.assetEvent.kind,
      before: s.assetEvent.before,
      after: s.assetEvent.after,
      changedAt: s.assetEvent.changedAt,
      changedBy: { id: s.user.id, name: s.user.name },
    })
    .from(s.assetEvent)
    .innerJoin(s.user, eq(s.assetEvent.changedBy, s.user.id))
    .where(eq(s.assetEvent.assetId, assetId))
    .orderBy(s.assetEvent.changedAt);
}

/** Furniture is counted; equipment and systems get one record per unit so each carries its own condition. */
async function assertQuantityAllowed(db: Db, assetTypeId: string, quantity: number) {
  const [type] = await db.select().from(s.assetType).where(eq(s.assetType.id, assetTypeId));
  if (!type) throw notFound('asset type');
  if (type.trackedIndividually && quantity !== 1) {
    throw badRequest(`${type.name} is tracked individually; add one record per unit`);
  }
}

/** Loads the live asset and checks the client's version against it. */
async function requireVersion(db: Db, id: string, version: number): Promise<AssetView> {
  const current = await getAsset(db, id);
  if (!current) throw notFound('asset');
  if (current.version !== version) throw conflict(current);
  return current;
}

/**
 * Applies changes guarded by the version predicate, so a writer that slipped in between the
 * read in requireVersion and this update still loses rather than being overwritten.
 */
async function writeVersioned(db: Db, id: string, version: number, changes: Partial<typeof s.asset.$inferInsert>) {
  const [row] = await db
    .update(s.asset)
    .set({ ...changes, version: sql`${s.asset.version} + 1`, updatedAt: new Date() })
    .where(and(eq(s.asset.id, id), eq(s.asset.version, version), liveAssets))
    .returning({ id: s.asset.id });
  if (!row) throw conflict(await getAsset(db, id));
}

export async function createAsset(db: Db, input: CreateAssetInput, actorId: string): Promise<AssetView> {
  const location = await resolveLocation(db, input);
  await assertQuantityAllowed(db, input.assetTypeId, input.quantity);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.asset)
      .values({
        ...location,
        assetTypeId: input.assetTypeId,
        label: input.label ?? null,
        quantity: input.quantity,
        condition: input.condition,
        notes: input.notes ?? null,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        installYear: input.installYear ?? null,
      })
      .returning({ id: s.asset.id });
    await attachPhotos(tx, row!.id, input.photoIds);
    const created = (await getAsset(tx, row!.id))!;
    await tx.insert(s.assetEvent).values({ assetId: created.id, kind: 'created', after: created, changedBy: actorId });
    return created;
  });
}

/**
 * Copies an asset's descriptive fields to another location as a new record with its own
 * version and history. Photos and the serial number stay with the original: they identify
 * that unit, not this one.
 */
export async function copyAsset(db: Db, id: string, input: CopyAssetInput, actorId: string): Promise<AssetView> {
  const source = await getAsset(db, id);
  if (!source) throw notFound('asset');
  return createAsset(
    db,
    {
      ...input,
      assetTypeId: source.assetType.id,
      label: source.label,
      quantity: source.quantity,
      condition: source.condition,
      notes: source.notes,
      manufacturer: source.manufacturer,
      model: source.model,
      installYear: source.installYear,
      photoIds: [],
    },
    actorId,
  );
}

export async function updateAsset(db: Db, id: string, input: UpdateAssetInput, actorId: string): Promise<AssetView> {
  return db.transaction(async (tx) => {
    const before = await requireVersion(tx, id, input.version);
    const assetTypeId = input.assetTypeId ?? before.assetType.id;
    const quantity = input.quantity ?? before.quantity;
    await assertQuantityAllowed(tx, assetTypeId, quantity);
    await writeVersioned(tx, id, input.version, {
      assetTypeId,
      quantity,
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.label !== undefined && { label: input.label }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.manufacturer !== undefined && { manufacturer: input.manufacturer }),
      ...(input.model !== undefined && { model: input.model }),
      ...(input.serialNumber !== undefined && { serialNumber: input.serialNumber }),
      ...(input.installYear !== undefined && { installYear: input.installYear }),
    });
    const after = (await getAsset(tx, id))!;
    await tx.insert(s.assetEvent).values({ assetId: id, kind: 'updated', before, after, changedBy: actorId });
    return after;
  });
}

const pickLocation = (a: Location): Location => ({ buildingId: a.buildingId, floorId: a.floorId, roomId: a.roomId });

export async function moveAsset(db: Db, id: string, input: MoveAssetInput, actorId: string): Promise<AssetView> {
  const location = await resolveLocation(db, input);
  return db.transaction(async (tx) => {
    const before = await requireVersion(tx, id, input.version);
    await writeVersioned(tx, id, input.version, location);
    const after = (await getAsset(tx, id))!;
    await tx.insert(s.assetEvent).values({
      assetId: id,
      kind: 'moved',
      before: pickLocation(before),
      after: pickLocation(after),
      changedBy: actorId,
    });
    return after;
  });
}

/** Soft delete: the row stays for history and the audit log, but leaves every listing and rollup. */
export async function deleteAsset(db: Db, id: string, version: number, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await requireVersion(tx, id, version);
    await writeVersioned(tx, id, version, { deletedAt: new Date() });
    await tx.insert(s.assetEvent).values({ assetId: id, kind: 'deleted', before, after: null, changedBy: actorId });
  });
}
