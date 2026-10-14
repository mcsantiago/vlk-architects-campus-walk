import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedCampus } from '../src/db/seed.ts';
import { CAMPUS } from '../src/db/seed-data.ts';
import { freshDb } from './helpers.ts';

/**
 * End-to-end over the HTTP layer against the real seed, so these double as a check that the
 * seed matches the numbers the README quotes.
 */

const WALKER = 'Test Walker';

type Tree = Awaited<ReturnType<typeof import('../src/services/campus.ts').getCampusTree>>;
type Room = Tree['buildings'][number]['floors'][number]['rooms'][number];

let h: DbHandle;
let app: App;
let campusId: string;
let userId: string;
let tree: Tree;
let typeId: Record<string, string>;

async function call(method: string, path: string, body?: unknown, user: string | null = userId) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(user && { 'x-user-id': user }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const building = (code: string) => tree.buildings.find((b) => b.code === code)!;
const room = (number: string): Room =>
  tree.buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms)).find((r) => r.number === number)!;

beforeAll(async () => {
  h = await freshDb();
  campusId = await seedCampus(h.db, CAMPUS);
  app = createApp({ db: h.db });
  userId = (await call('POST', '/users', { name: WALKER }, null)).body.id;
  tree = (await call('GET', `/campuses/${campusId}/tree`)).body;
  const types: { id: string; name: string }[] = (await call('GET', '/asset-types')).body;
  typeId = Object.fromEntries(types.map((t) => [t.name, t.id]));
});
afterAll(() => h.close());

describe('users', () => {
  it('finds or creates by name, case-insensitively', async () => {
    const again = await call('POST', '/users', { name: '  test walker ' }, null);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(userId);
    expect(again.body.name).toBe(WALKER);

    const list = (await call('GET', '/users', undefined, null)).body;
    expect(list.map((u: { name: string }) => u.name)).toEqual(['Dana R.', 'Priya S.', WALKER]);
    expect((await call('POST', '/users', { name: '' }, null)).status).toBe(400);
  });

  it('requires a known user for writes but not reads', async () => {
    const r = room('105');
    expect((await call('GET', `/rooms/${r.id}`, undefined, null)).status).toBe(200);
    const missing = await call('POST', `/rooms/${r.id}/walked`, undefined, null);
    expect(missing.status).toBe(401);
    expect(missing.body.error).toMatch(/x-user-id/);
    expect((await call('POST', `/rooms/${r.id}/walked`, undefined, randomUUID())).status).toBe(401);
    expect((await call('POST', `/rooms/${r.id}/walked`, undefined, 'not-a-uuid')).status).toBe(401);
  });
});

describe('browse', () => {
  it('lists campuses', async () => {
    const { status, body } = await call('GET', '/campuses');
    expect(status).toBe(200);
    expect(body).toEqual([expect.objectContaining({ id: campusId, name: 'Live Oak K-8' })]);
  });

  it('returns the tree with walk progress and counts', () => {
    expect(tree.buildings.map((b) => b.code)).toEqual(['A', 'B', 'C', 'P']);
    expect(tree.progress).toEqual({ rooms: 36, walked: 16 });
    expect(building('A').floors.map((f) => f.level)).toEqual([1, 2]);
    expect(building('A').systemAssetCount).toBe(11); // 6 building-level + 5 floor-level records
    expect(room('101')).toMatchObject({ assetCount: 6, walkedBy: { name: 'Dana R.' } });
    expect(room('105')).toMatchObject({ assetCount: 0, walkedAt: null, walkedBy: null });
  });

  it('returns a room with its assets and ancestry', async () => {
    const { status, body } = await call('GET', `/rooms/${room('101').id}`);
    expect(status).toBe(200);
    expect(body.building.code).toBe('A');
    expect(body.floor.level).toBe(1);
    expect(body.walkedBy.name).toBe('Dana R.');
    expect(body.assets).toHaveLength(6);
    expect(body.assets[0].assetType.name).toBeTypeOf('string');
  });

  it('returns building systems (no room) for a building', async () => {
    const { body } = await call('GET', `/buildings/${building('A').id}/systems`);
    expect(body).toHaveLength(11);
    expect(body.every((a: { roomId: string | null }) => a.roomId === null)).toBe(true);
    expect(body.filter((a: { floorId: string | null }) => a.floorId === null)).toHaveLength(6);
  });

  it('404s on unknown and malformed ids', async () => {
    expect((await call('GET', `/rooms/${randomUUID()}`)).status).toBe(404);
    expect((await call('GET', '/rooms/not-a-uuid')).status).toBe(404);
    expect((await call('GET', '/nope')).body).toEqual({ error: 'not found', details: null });
  });
});

describe('asset lifecycle', () => {
  let id: string;

  it('creates an asset from just a roomId and records the event', async () => {
    const { status, body } = await call('POST', '/assets', {
      roomId: room('101').id,
      assetTypeId: typeId['Projector'],
      condition: 4,
      notes: 'ceiling mount',
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      buildingId: building('A').id,
      floorId: room('101').floorId,
      roomId: room('101').id,
      quantity: 1,
      version: 1,
      assetType: { name: 'Projector', trackedIndividually: true },
    });
    id = body.id;

    const detail = (await call('GET', `/assets/${id}`)).body;
    expect(detail.events).toEqual([expect.objectContaining({ kind: 'created', changedBy: { id: userId, name: WALKER } })]);
    expect((await call('GET', `/rooms/${room('101').id}`)).body.assets).toHaveLength(7);
  });

  it('rejects bad input with readable errors', async () => {
    const base = { roomId: room('101').id, condition: 3 };
    const cases: [unknown, number, RegExp][] = [
      [{ ...base, assetTypeId: typeId['Rooftop HVAC Unit'], quantity: 3 }, 400, /tracked individually/],
      [{ ...base, assetTypeId: typeId['Student Desk'], floorId: room('201').floorId }, 400, /not on the given floor/],
      [{ assetTypeId: typeId['Student Desk'], condition: 3 }, 400, /validation failed/],
      [{ ...base, assetTypeId: typeId['Student Desk'], condition: 9 }, 400, /validation failed/],
      [{ ...base, assetTypeId: randomUUID() }, 404, /asset type not found/],
      [{ roomId: randomUUID(), assetTypeId: typeId['Student Desk'], condition: 3 }, 404, /room not found/],
    ];
    for (const [input, status, message] of cases) {
      const res = await call('POST', '/assets', input);
      expect(res.status, JSON.stringify(input)).toBe(status);
      expect(res.body.error).toMatch(message);
    }
    const raw = await app.request('/assets', {
      method: 'POST',
      body: '{nope',
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
    });
    expect(raw.status).toBe(400);
  });

  it('updates with optimistic concurrency', async () => {
    const stale = await call('PATCH', `/assets/${id}`, { version: 99, condition: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.details.current.version).toBe(1);

    const ok = await call('PATCH', `/assets/${id}`, { version: 1, condition: 2, notes: null });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ version: 2, condition: 2, notes: null });

    const replay = await call('PATCH', `/assets/${id}`, { version: 1, condition: 5 });
    expect(replay.status).toBe(409);

    const typeChange = await call('PATCH', `/assets/${id}`, { version: 2, assetTypeId: typeId['Student Desk'], quantity: 30 });
    expect(typeChange.status).toBe(200);
    expect(typeChange.body.assetType.name).toBe('Student Desk');
    const back = await call('PATCH', `/assets/${id}`, { version: 3, assetTypeId: typeId['Projector'] });
    expect(back.status).toBe(400); // quantity is still 30
    expect(back.body.error).toMatch(/tracked individually/);
    const fixed = await call('PATCH', `/assets/${id}`, { version: 3, assetTypeId: typeId['Projector'], quantity: 1 });
    expect(fixed.status).toBe(200);
    expect(fixed.body.version).toBe(4);
  });

  it('moves between rooms, levels and buildings, recording each move', async () => {
    const toBuilding = await call('POST', `/assets/${id}/move`, { version: 4, buildingId: building('B').id });
    expect(toBuilding.status).toBe(200);
    expect(toBuilding.body).toMatchObject({ buildingId: building('B').id, floorId: null, roomId: null, version: 5 });

    const toRoom = await call('POST', `/assets/${id}/move`, { version: 5, roomId: room('B103').id });
    expect(toRoom.body).toMatchObject({ buildingId: building('B').id, floorId: room('B103').floorId, roomId: room('B103').id });

    const toFloor = await call('POST', `/assets/${id}/move`, { version: 6, floorId: room('201').floorId });
    expect(toFloor.body).toMatchObject({ buildingId: building('A').id, floorId: room('201').floorId, roomId: null });

    expect((await call('POST', `/assets/${id}/move`, { version: 6, roomId: room('101').id })).status).toBe(409);
    const bad = await call('POST', `/assets/${id}/move`, { version: 7, floorId: room('101').floorId, roomId: room('B101').id });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not on the given floor/);

    const { events } = (await call('GET', `/assets/${id}`)).body;
    const moves = events.filter((e: { kind: string }) => e.kind === 'moved');
    expect(moves).toHaveLength(3);
    expect(moves[0].before.roomId).toBe(room('101').id);
    expect(moves[0].after).toEqual({ buildingId: building('B').id, floorId: null, roomId: null });
    expect(moves.every((e: { changedBy: { name: string } }) => e.changedBy.name === WALKER)).toBe(true);
  });

  it('soft deletes and hides the asset everywhere', async () => {
    expect((await call('DELETE', `/assets/${id}`, { version: 1 })).status).toBe(409);
    expect((await call('DELETE', `/assets/${id}`, { version: 7 })).status).toBe(204);
    expect((await call('GET', `/assets/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/assets/${id}`, { version: 8, condition: 3 })).status).toBe(404);
    expect((await call('GET', `/rooms/${room('101').id}`)).body.assets).toHaveLength(6);
  });
});

describe('walk status', () => {
  it('marks and unmarks a room walked by the current user', async () => {
    const r = room('105');
    const marked = await call('POST', `/rooms/${r.id}/walked`);
    expect(marked.status).toBe(200);
    expect(marked.body.walkedBy).toEqual({ id: userId, name: WALKER });
    expect(marked.body.walkedAt).toBeTypeOf('string');
    const summary = (await call('GET', `/campuses/${campusId}/summary`)).body;
    expect(summary.rooms.walked).toBe(17);
    expect(summary.walkers).toContainEqual({ user: { id: userId, name: WALKER }, roomsWalked: 1 });

    const cleared = await call('DELETE', `/rooms/${r.id}/walked`);
    expect(cleared.body).toMatchObject({ walkedAt: null, walkedBy: null });
    expect((await call('GET', `/campuses/${campusId}/summary`)).body.rooms.walked).toBe(16);
  });
});

describe('office summary', () => {
  it('rolls up the campus', async () => {
    const { status, body } = await call('GET', `/campuses/${campusId}/summary`);
    expect(status).toBe(200);
    expect(body.rooms).toMatchObject({ total: 36, walked: 16 });
    expect(body.rooms.notWalked).toHaveLength(20);
    // 203 has assets but was never marked walked: still outstanding.
    expect(body.rooms.notWalked.find((r: { number: string }) => r.number === '203')).toMatchObject({ assetCount: 2 });

    expect(body.walkers).toEqual([
      { user: expect.objectContaining({ name: 'Dana R.' }), roomsWalked: 9 },
      { user: expect.objectContaining({ name: 'Priya S.' }), roomsWalked: 7 },
    ]);

    const desks = body.countsByType.find((t: { name: string }) => t.name === 'Student Desk');
    expect(desks).toMatchObject({ records: 8, units: 198, category: 'furniture' });
    // Sorted by units: chairs lead because 104 has 6 extra broken ones recorded separately.
    expect(body.countsByType[0]).toMatchObject({ name: 'Student Chair', records: 9, units: 204 });

    expect(body.poorConditionMax).toBe(2);
    expect(body.poorCondition).toHaveLength(9);
    expect(body.poorCondition[0].condition).toBe(1);
    expect(body.poorCondition.every((a: { condition: number }) => a.condition <= 2)).toBe(true);
    const rtu = body.poorCondition.find((a: { label: string | null }) => a.label === 'RTU-2');
    expect(rtu).toMatchObject({ building: { code: 'A' }, floor: null, room: null });
  });

  it('filters by building', async () => {
    const { body } = await call('GET', `/campuses/${campusId}/summary?buildingId=${building('B').id}`);
    expect(body.rooms).toMatchObject({ total: 7, walked: 3 });
    expect(body.walkers).toEqual([{ user: expect.objectContaining({ name: 'Priya S.' }), roomsWalked: 3 }]);
    expect(body.poorCondition.map((a: { assetType: { name: string } }) => a.assetType.name).sort()).toEqual([
      'Cafeteria Table',
      'Dishwasher',
      'Scoreboard',
    ]);
    expect(body.countsByType.every((t: { name: string }) => t.name !== 'Student Desk')).toBe(true);
  });
});

describe('copy', () => {
  it('copies the descriptive fields to another room as a new record, leaving photos behind', async () => {
    const source = (
      await call('POST', '/assets', {
        roomId: room('104').id,
        assetTypeId: typeId['Student Desk'],
        quantity: 24,
        condition: 3,
        label: 'row desks',
        notes: 'laminate chipped on several',
      })
    ).body;

    const copy = await call('POST', `/assets/${source.id}/copy`, { roomId: room('106').id });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({
      roomId: room('106').id,
      floorId: room('106').floorId,
      quantity: 24,
      condition: 3,
      label: 'row desks',
      notes: 'laminate chipped on several',
      version: 1,
      assetType: { name: 'Student Desk' },
    });
    expect(copy.body.id).not.toBe(source.id);
    expect((await call('GET', `/assets/${copy.body.id}`)).body.events).toEqual([
      expect.objectContaining({ kind: 'created', changedBy: { id: userId, name: WALKER } }),
    ]);
    // the original is untouched
    expect((await call('GET', `/assets/${source.id}`)).body).toMatchObject({ roomId: room('104').id, version: 1 });

    // building level copy, bad location, unknown source
    expect((await call('POST', `/assets/${source.id}/copy`, { buildingId: building('B').id })).body).toMatchObject({
      buildingId: building('B').id,
      floorId: null,
      roomId: null,
    });
    expect((await call('POST', `/assets/${source.id}/copy`, {})).status).toBe(400);
    expect((await call('POST', `/assets/${randomUUID()}/copy`, { roomId: room('106').id })).status).toBe(404);
    expect((await call('POST', `/assets/${source.id}/copy`, { roomId: room('106').id }, null)).status).toBe(401);
  });
});

describe('asset types', () => {
  it('lets a walker add a type from the field, once, and use it straight away', async () => {
    const before = (await call('GET', '/asset-types')).body.length;
    const kiln = await call('POST', '/asset-types', { name: '  Kiln ', category: 'equipment', trackedIndividually: true });
    expect(kiln.status).toBe(201);
    expect(kiln.body).toMatchObject({ name: 'Kiln', category: 'equipment', trackedIndividually: true });

    // same name in another case finds it; the stored category wins over what was sent
    const again = await call('POST', '/asset-types', { name: 'kiln', category: 'furniture', trackedIndividually: false });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(kiln.body);
    expect((await call('GET', '/asset-types')).body.length).toBe(before + 1);

    const asset = await call('POST', '/assets', { roomId: room('104').id, assetTypeId: kiln.body.id, condition: 4 });
    expect(asset.status).toBe(201);
    expect(asset.body.assetType).toEqual(kiln.body);

    expect((await call('POST', '/asset-types', { name: '', category: 'equipment', trackedIndividually: true })).status).toBe(400);
    expect((await call('POST', '/asset-types', { name: 'Forge', category: 'tools', trackedIndividually: true })).status).toBe(400);
    expect((await call('POST', '/asset-types', { name: 'Forge', category: 'equipment', trackedIndividually: true }, null)).status).toBe(401);
  });

  it('recategorises a type and every asset of it follows', async () => {
    const kiln = (await call('POST', '/asset-types', { name: 'Kiln', category: 'equipment', trackedIndividually: true })).body;
    const asset = (await call('POST', '/assets', { roomId: room('104').id, assetTypeId: kiln.id, condition: 3 })).body;

    const moved = await call('PATCH', `/asset-types/${kiln.id}`, { category: 'technology' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id: kiln.id, name: 'Kiln', category: 'technology', trackedIndividually: true });
    expect((await call('GET', `/assets/${asset.id}`)).body.assetType.category).toBe('technology');
    const summary = (await call('GET', `/campuses/${campusId}/summary`)).body;
    expect(summary.countsByType.find((t: { name: string }) => t.name === 'Kiln')).toMatchObject({ category: 'technology' });

    // counted -> per unit is refused while a record counts more than one
    const desk = (await call('GET', '/asset-types')).body.find((t: { name: string }) => t.name === 'Student Desk');
    const refused = await call('PATCH', `/asset-types/${desk.id}`, { trackedIndividually: true });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/quantity above 1/);

    expect((await call('PATCH', `/asset-types/${kiln.id}`, {})).status).toBe(400);
    expect((await call('PATCH', `/asset-types/${kiln.id}`, { category: 'tools' })).status).toBe(400);
    expect((await call('PATCH', `/asset-types/${kiln.id}`, { category: 'equipment' }, null)).status).toBe(401);
    expect((await call('PATCH', `/asset-types/00000000-0000-0000-0000-000000000000`, { category: 'equipment' })).status).toBe(404);
  });
});

describe('inventory records', () => {
  it('keeps an unrated asset with its provenance until a walker rates it', async () => {
    const types = (await call('GET', '/asset-types')).body;
    const projector = types.find((t: { name: string }) => t.name === 'Projector');
    const created = await call('POST', '/assets', {
      roomId: room('104').id,
      assetTypeId: projector.id,
      manufacturer: 'Epson',
      model: 'PowerLite 992F',
      serialNumber: 'X9K2-0412',
      installYear: 2021,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ condition: null, manufacturer: 'Epson', model: 'PowerLite 992F', serialNumber: 'X9K2-0412', installYear: 2021 });

    const summary = (await call('GET', `/campuses/${campusId}/summary`)).body;
    expect(summary.notRated).toEqual({ records: 1, units: 1 });
    expect(summary.poorCondition.some((a: { id: string }) => a.id === created.body.id)).toBe(false);

    // a copy is a different unit: same make and model, no serial
    const copy = await call('POST', `/assets/${created.body.id}/copy`, { roomId: room('103').id });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ manufacturer: 'Epson', model: 'PowerLite 992F', serialNumber: null, installYear: 2021, condition: null });

    const rated = await call('PATCH', `/assets/${created.body.id}`, { version: 1, condition: 4 });
    expect(rated.status).toBe(200);
    expect(rated.body).toMatchObject({ condition: 4, serialNumber: 'X9K2-0412' });
    expect((await call('GET', `/campuses/${campusId}/summary`)).body.notRated).toEqual({ records: 1, units: 1 });

    expect((await call('POST', '/assets', { roomId: room('104').id, assetTypeId: projector.id, installYear: 1500 })).status).toBe(400);
  });
});
