import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from '../src/csv.ts';
import { createApp, type App } from '../src/app.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedCampus } from '../src/db/seed.ts';
import { CAMPUS } from '../src/db/seed-data.ts';
import { freshDb } from './helpers.ts';

describe('csv', () => {
  it('round-trips quotes, commas, newlines and dates', () => {
    const rows = [['a,b', 'say "hi"', 'two\nlines', null, 3, new Date('2026-10-12T00:00:00Z')]];
    const text = toCsv(['x', 'y', 'z', 'n', 'q', 'd'], rows);
    expect(text).toBe('x,y,z,n,q,d\r\n"a,b","say ""hi""","two\nlines",,3,2026-10-12T00:00:00.000Z\r\n');
    const parsed = parseCsv(text);
    expect(parsed).toEqual([
      { line: 1, values: ['x', 'y', 'z', 'n', 'q', 'd'] },
      { line: 2, values: ['a,b', 'say "hi"', 'two\nlines', '', '3', '2026-10-12T00:00:00.000Z'] },
    ]);
  });

  it('tracks line numbers past multi-line fields, skips blank lines, tolerates a BOM', () => {
    const parsed = parseCsv('﻿a,b\n"1\n2",x\n\n3,y');
    expect(parsed.map((r) => r.line)).toEqual([1, 2, 5]);
    expect(parsed[2]!.values).toEqual(['3', 'y']);
    expect(() => parseCsv('a,"b')).toThrow(/unterminated/);
  });

  it('maps header names case-insensitively and reports missing columns', () => {
    const out = parseCsvObjects('Room_Number,extra,building_code\r\n101,z,A\r\n', ['building_code', 'room_number']);
    expect(out).toEqual([{ line: 2, row: { building_code: 'A', room_number: '101' } }]);
    expect(() => parseCsvObjects('a\n1', ['a', 'b'])).toThrow(/missing columns: b/);
  });
});

describe('export / import', () => {
  let h: DbHandle;
  let app: App;
  let campusId: string;
  let userId: string;

  const headers = () => ({ 'x-user-id': userId });
  // Responses are checked structurally with expect(); a loose type keeps the assertions readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (res: Response): Promise<any> => res.json();

  beforeAll(async () => {
    h = await freshDb();
    campusId = await seedCampus(h.db, CAMPUS);
    app = createApp({ db: h.db });
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CSV Tester' }),
    });
    userId = (await json(res)).id;
  });
  afterAll(() => h.close());

  it('exports assets with their location and condition label', async () => {
    const res = await app.request(`/campuses/${campusId}/assets.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('building_code,building_name,floor_level,floor_name,room_number,room_name,asset_type,category,label,quantity,condition,condition_label,notes,updated_at,asset_id');
    const rtu = lines.find((l) => l.includes('RTU-2'))!;
    expect(rtu).toMatch(/^A,Main Classroom Building,,,,,Rooftop HVAC Unit,system,RTU-2,1,2,Poor,/);
    expect(lines.filter((l) => l.includes(',Student Desk,'))).toHaveLength(8);
  });

  it('exports rooms in the import format', async () => {
    const text = await (await app.request(`/campuses/${campusId}/rooms.csv`)).text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('building_code,building_name,floor_level,floor_name,room_number,room_name,room_type,walked_at');
    expect(lines).toHaveLength(37);
    expect(lines[1]).toMatch(/^A,Main Classroom Building,1,Floor 1,101,/);
  });

  it('imports new buildings, floors and rooms and updates existing ones', async () => {
    const csv = [
      'building_code,building_name,floor_level,floor_name,room_number,room_name,room_type',
      'A,Main Classroom Building,1,Floor 1,101,Kindergarten A (renamed),classroom',
      'A,,2,,299,New Storage,storage',
      'D,Library Annex,1,Ground,D101,Reading Room,library',
      'D,Library Annex,1,Ground,D102,,office',
      'D,Library Annex,-1,,D001,Mechanical,mechanical',
    ].join('\n');
    const res = await app.request(`/campuses/${campusId}/rooms/import`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'text/csv' },
      body: csv,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      rows: 5,
      buildings: { created: 1 },
      floors: { created: 2 },
      rooms: { created: 4, updated: 1 },
    });

    const tree = await json(await app.request(`/campuses/${campusId}/tree`));
    expect(tree.progress).toEqual({ rooms: 40, walked: 16 });
    const d = tree.buildings.find((b: { code: string }) => b.code === 'D');
    expect(d.floors.map((f: { level: number; name: string }) => [f.level, f.name])).toEqual([[-1, 'Floor -1'], [1, 'Ground']]);
    expect(d.floors[1].rooms.map((r: { number: string; name: string }) => [r.number, r.name])).toEqual([
      ['D101', 'Reading Room'],
      ['D102', 'D102'],
    ]);
    const a = tree.buildings.find((b: { code: string }) => b.code === 'A');
    const r101 = a.floors[0].rooms.find((r: { number: string }) => r.number === '101');
    expect(r101).toMatchObject({ name: 'Kindergarten A (renamed)', walkedBy: { name: 'Dana R.' } }); // walk status untouched
  });

  it('rejects bad rows with line numbers and writes nothing', async () => {
    const csv = [
      'building_code,building_name,floor_level,floor_name,room_number,room_name,room_type',
      'E,New,1,,E101,Ok,classroom',
      'E,New,one,,E102,Bad level,classroom',
      'E,New,1,,E103,Bad type,ballroom',
      'E,New,1,,E101,Dup,classroom',
    ].join('\r\n');
    const res = await app.request(`/campuses/${campusId}/rooms/import`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'text/csv' },
      body: csv,
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toMatch(/nothing was written/);
    expect(body.details.map((e: { line: number }) => e.line)).toEqual([3, 4, 5]);
    expect(body.details[1].message).toMatch(/room_type/);
    const tree = await json(await app.request(`/campuses/${campusId}/tree`));
    expect(tree.buildings.some((b: { code: string }) => b.code === 'E')).toBe(false);

    const noHeader = await app.request(`/campuses/${campusId}/rooms/import`, { method: 'POST', headers: headers(), body: 'x,y\n1,2' });
    expect(noHeader.status).toBe(400);
    expect((await json(noHeader)).error).toMatch(/missing columns/);
    expect((await app.request(`/campuses/${campusId}/rooms/import`, { method: 'POST', body: 'a' })).status).toBe(401);
  });
});
