import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { importInventory } from '../src/db/import-sample.ts';
import * as s from '../src/db/schema.ts';
import { seedCampus } from '../src/db/seed.ts';
import { CAMPUS } from '../src/db/seed-data.ts';
import { getCampusSummary } from '../src/services/campus.ts';
import { freshDb } from './helpers.ts';

/** The VLK sample inventory, loaded on top of the seed campus the way the demo database is. */
describe('inventory import', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await freshDb();
    await seedCampus(h.db, CAMPUS);
  });
  afterAll(() => h.close());

  it('loads both campuses with their rooms, walkers and unrated rows', async () => {
    const result = await importInventory(h.db);
    expect(result.skipped).toEqual([]);
    expect(result.campuses.map((c) => [c.name, c.buildings, c.rooms, c.assets, c.unrated])).toEqual([
      ['Bluebonnet Elementary', 3, 48, 246, 15],
      ['Cedar Ridge High School', 4, 129, 592, 207],
    ]);
    // 37 sample types, 14 already in the seed by name.
    expect(result.typesCreated).toBe(23);
    expect(result.notes).toEqual([]);

    const [campus] = await h.db.select().from(s.campus).where(eq(s.campus.name, 'Cedar Ridge High School'));
    expect(campus).toMatchObject({ district: 'Cedar Ridge ISD', address: '4500 Ridgeview Pkwy' });

    const summary = await getCampusSummary(h.db, campus!.id);
    expect(summary.rooms).toMatchObject({ total: 129, walked: 129 - 54 });
    expect(summary.notRated).toEqual({ records: 207, units: expect.any(Number) });
    // The files say when a room was walked, not by whom, so every walk is credited to the import.
    expect(summary.walkers).toEqual([{ user: expect.objectContaining({ name: 'Cedar Ridge ISD (import)' }), roomsWalked: 75 }]);
    // The Field House has not been started: every room outstanding, its systems unrated.
    const fieldHouse = summary.rooms.notWalked.filter((r) => r.building.code === 'B-204');
    expect(fieldHouse).toHaveLength(14);
    expect(summary.poorCondition.every((a) => a.condition !== null && a.condition <= 2)).toBe(true);
  });

  it('stores room types as the district wrote them', async () => {
    const types = await h.db.selectDistinct({ t: s.room.roomType }).from(s.room);
    const names = types.map((r) => r.t);
    expect(names).toEqual(expect.arrayContaining(['Science Lab', 'Band Hall', 'Training Room', 'Auditorium', 'classroom']));
  });

  it('maps the catalogue: technology is its own category, counted types follow the data', async () => {
    const types = await h.db.select().from(s.assetType);
    const byName = Object.fromEntries(types.map((t) => [t.name, t]));
    expect(byName['Wireless Access Point']).toMatchObject({ category: 'technology', trackedIndividually: true });
    expect(byName['Desktop Computer']).toMatchObject({ category: 'technology', trackedIndividually: false });
    expect(byName['Weight Rack']).toMatchObject({ category: 'equipment', trackedIndividually: false });
    expect(byName['Filing Cabinet']).toMatchObject({ category: 'furniture', trackedIndividually: false });
    expect(byName['Roof (Membrane)']).toMatchObject({ category: 'system', trackedIndividually: true });
    // Seed types are reused by name and keep their settings; near-synonyms stay separate.
    expect(byName['Projector']).toMatchObject({ category: 'technology' });
    expect(byName['Basketball Hoop']).toBeDefined();
    expect(byName['Basketball Goal']).toMatchObject({ category: 'equipment', trackedIndividually: false });
  });

  it('places assets and keeps who rated them and when', async () => {
    const [room101] = await h.db
      .select({ id: s.room.id, roomType: s.room.roomType, walkedAt: s.room.walkedAt, walker: s.user.name })
      .from(s.room)
      .innerJoin(s.floor, eq(s.room.floorId, s.floor.id))
      .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
      .leftJoin(s.user, eq(s.room.walkedById, s.user.id))
      .where(and(eq(s.building.code, 'B-101'), eq(s.room.number, '101')));
    // J. Okafor assessed 5 of the room's 7 assets, but nothing says who walked it: no guess.
    expect(room101).toMatchObject({ roomType: 'Classroom', walker: 'Cedar Ridge ISD (import)' });
    expect(room101!.walkedAt?.toISOString()).toBe('2026-09-22T17:00:00.000Z');

    const assets = await h.db
      .select({ label: s.asset.label, condition: s.asset.condition, quantity: s.asset.quantity, notes: s.asset.notes, installYear: s.asset.installYear, type: s.assetType.name })
      .from(s.asset)
      .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
      .where(eq(s.asset.roomId, room101!.id));
    expect(assets).toHaveLength(7);
    expect(assets.find((a) => a.label === 'CR-1004')).toMatchObject({ type: 'Teacher Desk', condition: 5, quantity: 1, notes: 'Recently replaced', installYear: 2018 });
    expect(assets.find((a) => a.type === 'Student Desk')).toMatchObject({ quantity: 23, condition: 4, label: null });

    // A building-level system: building only, with its serial, credited to its assessor on the assessment day (noon Central).
    const [rtu] = await h.db
      .select({ floorId: s.asset.floorId, roomId: s.asset.roomId, serial: s.asset.serialNumber, who: s.user.name, when: s.assetEvent.changedAt, after: s.assetEvent.after })
      .from(s.asset)
      .innerJoin(s.assetEvent, eq(s.assetEvent.assetId, s.asset.id))
      .innerJoin(s.user, eq(s.assetEvent.changedBy, s.user.id))
      .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
      .where(and(eq(s.assetType.name, 'Rooftop HVAC Unit'), eq(s.asset.label, 'CR-1205')));
    expect(rtu).toBeDefined();
    expect(rtu).toMatchObject({ floorId: null, roomId: null });
    expect(rtu).toMatchObject({ serial: 'SN96630662', who: 'A. Moreno' });
    expect(rtu!.when.toISOString()).toBe('2026-09-21T17:00:00.000Z');
    expect((rtu!.after as { assetType: { name: string } }).assetType.name).toBe('Rooftop HVAC Unit');

    // Rooms nobody has reached: assets on the books, unrated, credited to the import.
    const unrated = await h.db
      .select({ who: s.user.name })
      .from(s.asset)
      .innerJoin(s.assetEvent, eq(s.assetEvent.assetId, s.asset.id))
      .innerJoin(s.user, eq(s.assetEvent.changedBy, s.user.id))
      .where(isNull(s.asset.condition));
    expect(unrated).toHaveLength(222);
    expect(new Set(unrated.map((u) => u.who))).toEqual(new Set(['Cedar Ridge ISD (import)']));
  });

  it('is safe to run again', async () => {
    const again = await importInventory(h.db);
    expect(again.campuses).toEqual([]);
    expect(again.skipped).toEqual(['Bluebonnet Elementary', 'Cedar Ridge High School']);
    expect(again.typesCreated).toBe(0);
    expect((await h.db.select({ id: s.campus.id }).from(s.campus)).length).toBe(3);
  });
});

/** A district whose files do not match the sample: fewer columns, extra ones, its own words. */
describe('inventory import from a different district', () => {
  let h: DbHandle;
  let dir: URL;
  beforeAll(async () => {
    h = await freshDb();
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const path = await mkdtemp(join(tmpdir(), 'inventory-'));
    dir = pathToFileURL(`${path}/`);
    const files: Record<string, string[]> = {
      campuses: ['campus_id,name,enrollment', 'X1,Westfield Middle,640'],
      buildings: ['building_id,campus_id,name,roof_type', 'W1,X1,Main,TPO'],
      floors: ['floor_id,building_id,level', 'W1-1,W1,1', 'W1-B,W1,-1'],
      rooms: ['room_id,floor_id,room_number,room_type,room_name', 'W1-101,W1-1,101,Makerspace,STEM Lab', 'W1-B01,W1-B,B01,,'],
      asset_types: ['asset_type_id,name,category', 'T1,3D Printer,Technology', 'T2,Mascot Costume,Spirit Gear', 'T3,Boiler,building_system', 'T4,Irrigation Controller,Grounds'],
      assets: ['asset_type_id,building_id,floor_id,room_id,quantity,condition_rating,assessed_by,color', 'T1,W1,W1-1,W1-101,2,4,R. Diaz,grey', 'T2,W1,W1-1,W1-101,1,,,blue', 'T3,W1,,,1,2,R. Diaz,', 'T4,W1,,,1,3,R. Diaz,'],
    };
    for (const [name, lines] of Object.entries(files)) await writeFile(join(path, `${name}.csv`), lines.join('\n') + '\n');
    // A category added as a row, with no code change, is matched by name like the built-in ones.
    await h.db.insert(s.assetCategory).values({ key: 'grounds', name: 'Grounds', sortOrder: 50, color: '#558b2f', trackedByDefault: true });
  });
  afterAll(() => h.close());

  it('takes the files as data: unknown words are kept or noted, never fatal', async () => {
    const result = await importInventory(h.db, dir);
    expect(result.campuses).toEqual([expect.objectContaining({ name: 'Westfield Middle', buildings: 1, rooms: 2, assets: 4, unrated: 1 })]);
    expect(result.notes).toEqual([
      'rooms.csv:3 room B01 has no type; recorded as "other"',
      'asset_types.csv:3 category "Spirit Gear" for Mascot Costume is not one of ours; recorded as equipment',
    ]);
    const [campus] = await h.db.select().from(s.campus);
    expect(campus).toMatchObject({ district: 'District', address: null });
    const rooms = await h.db.select({ number: s.room.number, name: s.room.name, type: s.room.roomType }).from(s.room).orderBy(s.room.number);
    expect(rooms).toEqual([
      { number: '101', name: 'STEM Lab', type: 'Makerspace' },
      { number: 'B01', name: 'B01', type: 'other' },
    ]);
    const types = Object.fromEntries((await h.db.select().from(s.assetType)).map((t) => [t.name, t]));
    // Two printers in one row, so the type is counted; the costume falls back to equipment.
    expect(types['3D Printer']).toMatchObject({ category: 'technology', trackedIndividually: false });
    expect(types['Mascot Costume']).toMatchObject({ category: 'equipment', trackedIndividually: true });
    expect(types['Boiler']).toMatchObject({ category: 'system' });
    expect(types['Irrigation Controller']).toMatchObject({ category: 'grounds', trackedIndividually: true });
  });

  it('still refuses what the model cannot hold', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(new URL('assets.csv', dir), 'asset_type_id,building_id,room_id,condition_rating\nT1,W1,W1-999,7\nT9,W1,,\n');
    await expect(importInventory(h.db, dir)).rejects.toThrow(/unknown room W1-999[\s\S]*bad condition 7[\s\S]*unknown type T9/);
    await writeFile(new URL('assets.csv', dir), 'building_id\nW1\n');
    await expect(importInventory(h.db, dir)).rejects.toThrow(/assets.csv is missing columns: asset_type_id/);
  });

  it('refuses repeated source ids and tags instead of letting the last row win', async () => {
    const { writeFile } = await import('node:fs/promises');
    const typesBefore = (await h.db.select().from(s.assetType)).length;
    const campusesBefore = (await h.db.select().from(s.campus)).length;
    await writeFile(new URL('campuses.csv', dir), 'campus_id,name\nX2,Eastfield Middle\n');
    await writeFile(new URL('buildings.csv', dir), 'building_id,campus_id,name\nE1,X2,Main\n');
    await writeFile(new URL('floors.csv', dir), 'floor_id,building_id,level\nE1-1,E1,1\n');
    await writeFile(new URL('rooms.csv', dir), 'room_id,floor_id,room_number\nE1-101,E1-1,101\nE1-102,E1-1,101\n');
    // Same id, different names: without the check the assets would silently become Stage Lights.
    await writeFile(new URL('asset_types.csv', dir), 'asset_type_id,name,category\nT1,Kiln,Equipment\nT1,Stage Lights,Equipment\n');
    await writeFile(new URL('assets.csv', dir), 'asset_id,asset_tag,asset_type_id,building_id\nA1,CR-1,T1,E1\nA2,CR-1,T1,E1\nA2,CR-3,T1,E1\n');
    const refused = importInventory(h.db, dir);
    await expect(refused).rejects.toThrow(/rooms.csv:3 duplicate floor and room number E1-1 \/ 101 \(first on line 2\)/);
    await expect(importInventory(h.db, dir)).rejects.toThrow(/asset_types.csv:3 duplicate asset_type_id T1 \(first on line 2\)/);
    await expect(importInventory(h.db, dir)).rejects.toThrow(/assets.csv:4 duplicate asset_id A2 \(first on line 3\)/);
    await expect(importInventory(h.db, dir)).rejects.toThrow(/assets.csv:3 duplicate asset_tag CR-1 \(first on line 2\)/);
    // Nothing was written.
    expect((await h.db.select().from(s.assetType)).length).toBe(typesBefore);
    expect((await h.db.select().from(s.campus)).length).toBe(campusesBefore);
  });
});
