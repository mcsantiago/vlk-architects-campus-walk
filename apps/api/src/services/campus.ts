import { and, count, eq, getTableColumns, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { POOR_CONDITION_MAX } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { assetView, listAssets, liveAssets } from './assets.ts';

/** Correlated count of live assets matching `where`, usable as a selected column. */
const liveAssetCount = (where: SQL) =>
  sql<number>`(select count(*) from ${s.asset} where ${where} and ${s.asset.deletedAt} is null)`.mapWith(Number);

/** The user who marked a room walked; null (via left join) when nobody has. */
const walkedBy = { id: s.user.id, name: s.user.name };

async function requireCampus(db: Db, campusId: string) {
  const [campus] = await db.select().from(s.campus).where(eq(s.campus.id, campusId));
  if (!campus) throw notFound('campus');
  return campus;
}

export function listCampuses(db: Db) {
  return db.select().from(s.campus).orderBy(s.campus.name);
}

/** Everything the field app needs to navigate: buildings -> floors -> rooms, with walk status and counts. */
export async function getCampusTree(db: Db, campusId: string) {
  const campus = await requireCampus(db, campusId);

  const buildings = await db
    .select({
      ...getTableColumns(s.building),
      /** Assets at building or floor level, shown under "Building systems". */
      systemAssetCount: liveAssetCount(and(eq(s.asset.buildingId, s.building.id), isNull(s.asset.roomId))!),
    })
    .from(s.building)
    .where(eq(s.building.campusId, campusId))
    .orderBy(s.building.code);

  const floors = await db
    .select(getTableColumns(s.floor))
    .from(s.floor)
    .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
    .where(eq(s.building.campusId, campusId))
    .orderBy(s.floor.level);

  const rooms = await db
    .select({
      ...getTableColumns(s.room),
      assetCount: liveAssetCount(eq(s.asset.roomId, s.room.id)),
      walkedBy,
    })
    .from(s.room)
    .innerJoin(s.floor, eq(s.room.floorId, s.floor.id))
    .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
    .leftJoin(s.user, eq(s.room.walkedById, s.user.id))
    .where(eq(s.building.campusId, campusId))
    .orderBy(s.room.number);

  return {
    ...campus,
    progress: { rooms: rooms.length, walked: rooms.filter((r) => r.walkedAt).length },
    buildings: buildings.map((b) => ({
      ...b,
      floors: floors
        .filter((f) => f.buildingId === b.id)
        .map((f) => ({ ...f, rooms: rooms.filter((r) => r.floorId === f.id) })),
    })),
  };
}

/** A room with its ancestry and walker, without assets. */
export async function roomHeader(db: Db, roomId: string) {
  const [room] = await db
    .select({
      ...getTableColumns(s.room),
      walkedBy,
      floor: { id: s.floor.id, name: s.floor.name, level: s.floor.level },
      building: { id: s.building.id, name: s.building.name, code: s.building.code },
    })
    .from(s.room)
    .innerJoin(s.floor, eq(s.room.floorId, s.floor.id))
    .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
    .leftJoin(s.user, eq(s.room.walkedById, s.user.id))
    .where(eq(s.room.id, roomId));
  if (!room) throw notFound('room');
  return room;
}

export async function getRoom(db: Db, roomId: string) {
  const room = await roomHeader(db, roomId);
  return { ...room, assets: await listAssets(db, eq(s.asset.roomId, roomId)) };
}

/** Marks a room walked by `userId`, or clears the mark when null. Idempotent; last writer wins. */
export async function setRoomWalked(db: Db, roomId: string, userId: string | null) {
  const [row] = await db
    .update(s.room)
    .set(userId ? { walkedAt: new Date(), walkedById: userId } : { walkedAt: null, walkedById: null })
    .where(eq(s.room.id, roomId))
    .returning({ id: s.room.id });
  if (!row) throw notFound('room');
  return roomHeader(db, roomId);
}

/** Building- and floor-level assets (rooftop units, corridor panels): everything in the building with no room. */
export async function listBuildingSystems(db: Db, buildingId: string) {
  const [building] = await db.select().from(s.building).where(eq(s.building.id, buildingId));
  if (!building) throw notFound('building');
  return listAssets(db, and(eq(s.asset.buildingId, buildingId), isNull(s.asset.roomId)));
}

export async function getCampusSummary(db: Db, campusId: string, buildingId?: string) {
  const campus = await requireCampus(db, campusId);
  const scope = and(eq(s.building.campusId, campusId), buildingId ? eq(s.building.id, buildingId) : undefined);

  const countsByType = await db
    .select({
      assetTypeId: s.assetType.id,
      name: s.assetType.name,
      category: s.assetType.category,
      records: count(),
      units: sql<number>`sum(${s.asset.quantity})`.mapWith(Number),
    })
    .from(s.asset)
    .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
    .innerJoin(s.building, eq(s.asset.buildingId, s.building.id))
    .where(and(liveAssets, scope))
    .groupBy(s.assetType.id, s.assetType.name, s.assetType.category);
  countsByType.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

  const [notRated] = await db
    .select({ records: count(), units: sql<number>`coalesce(sum(${s.asset.quantity}), 0)`.mapWith(Number) })
    .from(s.asset)
    .innerJoin(s.building, eq(s.asset.buildingId, s.building.id))
    .where(and(liveAssets, scope, isNull(s.asset.condition)));

  const poorCondition = await db
    .select({
      ...assetView,
      building: { id: s.building.id, code: s.building.code, name: s.building.name },
      floor: { id: s.floor.id, name: s.floor.name },
      room: { id: s.room.id, number: s.room.number, name: s.room.name },
    })
    .from(s.asset)
    .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
    .innerJoin(s.building, eq(s.asset.buildingId, s.building.id))
    .leftJoin(s.floor, eq(s.asset.floorId, s.floor.id))
    .leftJoin(s.room, eq(s.asset.roomId, s.room.id))
    .where(and(liveAssets, scope, lte(s.asset.condition, POOR_CONDITION_MAX)))
    .orderBy(s.asset.condition, s.building.code, s.room.number, s.assetType.name);

  const rooms = await db
    .select({
      id: s.room.id,
      number: s.room.number,
      name: s.room.name,
      roomType: s.room.roomType,
      walkedAt: s.room.walkedAt,
      walkedBy,
      assetCount: liveAssetCount(eq(s.asset.roomId, s.room.id)),
      floor: { id: s.floor.id, name: s.floor.name, level: s.floor.level },
      building: { id: s.building.id, code: s.building.code, name: s.building.name },
    })
    .from(s.room)
    .innerJoin(s.floor, eq(s.room.floorId, s.floor.id))
    .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
    .leftJoin(s.user, eq(s.room.walkedById, s.user.id))
    .where(scope)
    .orderBy(s.building.code, s.floor.level, s.room.number);

  const notWalked = rooms.filter((r) => !r.walkedAt).map(({ walkedAt: _at, walkedBy: _by, ...r }) => r);

  // Rooms walked per person, from the rows already fetched.
  const perWalker = new Map<string, { user: { id: string; name: string }; roomsWalked: number }>();
  for (const r of rooms) {
    if (!r.walkedBy) continue;
    const entry = perWalker.get(r.walkedBy.id) ?? { user: r.walkedBy, roomsWalked: 0 };
    entry.roomsWalked += 1;
    perWalker.set(r.walkedBy.id, entry);
  }
  const walkers = [...perWalker.values()].sort(
    (a, b) => b.roomsWalked - a.roomsWalked || a.user.name.localeCompare(b.user.name),
  );

  return {
    campus,
    buildingId: buildingId ?? null,
    rooms: { total: rooms.length, walked: rooms.length - notWalked.length, notWalked },
    walkers,
    countsByType,
    poorCondition,
    poorConditionMax: POOR_CONDITION_MAX,
    notRated: notRated!,
  };
}
