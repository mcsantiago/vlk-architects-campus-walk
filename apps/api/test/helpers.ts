import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';
import { createDb, type DbHandle } from '../src/db/client.ts';
import * as s from '../src/db/schema.ts';

/**
 * Drizzle wraps driver errors as `Failed query: ...` with the Postgres error on `cause`,
 * so the violated constraint's name has to be read from there.
 */
export async function expectConstraint(p: Promise<unknown>, constraint: string) {
  let err: unknown;
  await p.then(
    () => expect.fail(`expected ${constraint} violation, insert succeeded`),
    (e) => (err = e),
  );
  const cause = (err as { cause?: { message?: string } }).cause;
  expect(cause?.message, `expected ${constraint} in cause`).toMatch(constraint);
}

/**
 * An isolated, migrated database. In-memory PGlite by default; with TEST_DATABASE_URL set,
 * a throwaway database is created on that Postgres server and dropped on close, so the
 * same suite verifies both engines.
 */
export async function freshDb(): Promise<DbHandle> {
  const server = process.env.TEST_DATABASE_URL;
  if (!server) {
    const handle = createDb('pglite://memory');
    await handle.migrate();
    return handle;
  }

  const name = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = async (sql: string) => {
    const client = new pg.Client({ connectionString: server });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const handle = createDb(url.href);
  await handle.migrate();
  return {
    db: handle.db,
    migrate: handle.migrate,
    close: async () => {
      await handle.close();
      await admin(`DROP DATABASE ${name}`);
    },
  };
}

/** Two buildings, each with two floors and two rooms per floor, plus one asset type of each kind. */
export async function buildFixture({ db }: DbHandle) {
  const [c] = await db.insert(s.campus).values({ name: 'Test Campus', district: 'Test USD' }).returning();
  const buildings = await db
    .insert(s.building)
    .values([
      { campusId: c!.id, name: 'Main', code: 'A' },
      { campusId: c!.id, name: 'Gym', code: 'B' },
    ])
    .returning();

  const out = [];
  for (const b of buildings) {
    const floors = await db
      .insert(s.floor)
      .values([
        { buildingId: b.id, name: 'Floor 1', level: 1 },
        { buildingId: b.id, name: 'Floor 2', level: 2 },
      ])
      .returning();
    const rooms = [];
    for (const f of floors) {
      rooms.push(
        await db
          .insert(s.room)
          .values([
            { floorId: f.id, number: `${b.code}${f.level}01`, name: 'Room 1', roomType: 'classroom' },
            { floorId: f.id, number: `${b.code}${f.level}02`, name: 'Room 2', roomType: 'classroom' },
          ])
          .returning(),
      );
    }
    out.push({ building: b, floors, rooms });
  }

  const types = await db
    .insert(s.assetType)
    .values([
      { name: 'Student Desk', category: 'furniture', trackedIndividually: false },
      { name: 'Rooftop HVAC Unit', category: 'system', trackedIndividually: true },
    ])
    .returning();

  return { campus: c!, buildings: out, desk: types[0]!, hvac: types[1]! };
}
