import { eq } from 'drizzle-orm';
import type { LocationInput } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';

export interface Location {
  buildingId: string;
  floorId: string | null;
  roomId: string | null;
}

/**
 * Fills in the levels above whatever the client sent (room -> floor -> building) and rejects
 * levels that disagree. The database's composite foreign keys enforce the same invariant; this
 * exists so the client can send just a roomId and get a readable error instead of an FK message.
 */
export async function resolveLocation(db: Db, input: LocationInput): Promise<Location> {
  let { buildingId } = input;
  let floorId = input.floorId ?? null;
  const roomId = input.roomId ?? null;

  if (roomId) {
    const [room] = await db.select({ floorId: s.room.floorId }).from(s.room).where(eq(s.room.id, roomId));
    if (!room) throw notFound('room');
    if (floorId && floorId !== room.floorId) throw badRequest('room is not on the given floor');
    floorId = room.floorId;
  }
  if (floorId) {
    const [floor] = await db.select({ buildingId: s.floor.buildingId }).from(s.floor).where(eq(s.floor.id, floorId));
    if (!floor) throw notFound('floor');
    if (buildingId && buildingId !== floor.buildingId) throw badRequest('floor is not in the given building');
    buildingId = floor.buildingId;
  }
  if (!buildingId) throw badRequest('one of buildingId, floorId or roomId is required');

  const [building] = await db.select({ id: s.building.id }).from(s.building).where(eq(s.building.id, buildingId));
  if (!building) throw notFound('building');

  return { buildingId, floorId, roomId };
}
