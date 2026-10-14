import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import * as s from '../src/db/schema.ts';
import { buildFixture, expectConstraint, freshDb } from './helpers.ts';

/**
 * These tests pin down the location invariant at the database level, so that no API bug can
 * ever produce an asset whose room, floor and building disagree.
 */
describe('asset location constraints', () => {
  let h: DbHandle;
  let f: Awaited<ReturnType<typeof buildFixture>>;

  beforeAll(async () => {
    h = await freshDb();
    f = await buildFixture(h);
  });
  afterAll(() => h.close());

  const main = () => f.buildings[0]!;
  const gym = () => f.buildings[1]!;

  const insert = (loc: { buildingId: string; floorId?: string | null; roomId?: string | null }) =>
    h.db
      .insert(s.asset)
      .values({ ...loc, assetTypeId: f.desk.id, condition: 3 })
      .returning();

  it('accepts a building-level asset (rooftop HVAC)', async () => {
    await expect(insert({ buildingId: main().building.id })).resolves.toHaveLength(1);
  });

  it('accepts a floor-level asset (corridor fire alarm panel)', async () => {
    await expect(insert({ buildingId: main().building.id, floorId: main().floors[0]!.id })).resolves.toHaveLength(1);
  });

  it('accepts a room-level asset on the matching floor and building', async () => {
    const room = main().rooms[1]![0]!;
    await expect(
      insert({ buildingId: main().building.id, floorId: room.floorId, roomId: room.id }),
    ).resolves.toHaveLength(1);
  });

  it('rejects a room without a floor', async () => {
    const room = main().rooms[0]![0]!;
    await expectConstraint(insert({ buildingId: main().building.id, roomId: room.id }), 'asset_room_needs_floor_ck');
  });

  it('rejects a room that is not on the given floor', async () => {
    const roomOnFloor2 = main().rooms[1]![0]!;
    await expectConstraint(
      insert({ buildingId: main().building.id, floorId: main().floors[0]!.id, roomId: roomOnFloor2.id }),
      'asset_room_on_floor_fk',
    );
  });

  it('rejects a floor that belongs to another building', async () => {
    await expectConstraint(
      insert({ buildingId: main().building.id, floorId: gym().floors[0]!.id }),
      'asset_floor_in_building_fk',
    );
  });

  it('rejects a room/floor pair from another building', async () => {
    const gymRoom = gym().rooms[0]![0]!;
    await expectConstraint(
      insert({ buildingId: main().building.id, floorId: gymRoom.floorId, roomId: gymRoom.id }),
      'asset_floor_in_building_fk',
    );
  });

  it('rejects out-of-range condition and non-positive quantity, but allows "not rated"', async () => {
    const base = { buildingId: main().building.id, assetTypeId: f.desk.id };
    await expectConstraint(h.db.insert(s.asset).values({ ...base, condition: 6 }), 'asset_condition_ck');
    await expectConstraint(h.db.insert(s.asset).values({ ...base, condition: 0 }), 'asset_condition_ck');
    await expectConstraint(h.db.insert(s.asset).values({ ...base, condition: 3, quantity: 0 }), 'asset_quantity_ck');
    await expectConstraint(h.db.insert(s.asset).values({ ...base, condition: 3, installYear: 1750 }), 'asset_install_year_ck');
    const [unrated] = await h.db.insert(s.asset).values({ ...base, condition: null }).returning();
    expect(unrated!.condition).toBeNull();
  });
});

describe('room walked status', () => {
  let h: DbHandle;
  let f: Awaited<ReturnType<typeof buildFixture>>;

  beforeAll(async () => {
    h = await freshDb();
    f = await buildFixture(h);
  });
  afterAll(() => h.close());

  it('requires walked_by whenever walked_at is set', async () => {
    const floorId = f.buildings[0]!.floors[0]!.id;
    await expectConstraint(
      h.db.insert(s.room).values({ floorId, number: 'X1', name: 'x', roomType: 'other', walkedAt: new Date() }),
      'room_walked_by_ck',
    );
  });
});
