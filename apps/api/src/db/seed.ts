import { pathToFileURL } from 'node:url';
import { count } from 'drizzle-orm';
import { createDb, type Db } from './client.ts';
import * as s from './schema.ts';
import { ASSET_TYPES, CAMPUS, type AssetSpec, type CampusSpec } from './seed-data.ts';

const SEED_ACTOR = 'seed';
const DAY_MS = 86_400_000;

/**
 * Loads a campus spec. Returns the campus id so tests can seed the same fixture.
 * Every asset gets a `created` event so the audit log convention holds for seeded rows too.
 */
export async function seedCampus(db: Db, spec: CampusSpec, now = new Date()) {
  const typeIds = new Map<string, string>();
  const typeRows = await db.insert(s.assetType).values(ASSET_TYPES).onConflictDoNothing().returning();
  for (const t of typeRows) typeIds.set(t.name, t.id);
  // Asset types already present (re-seeding) come back empty from the insert.
  if (typeIds.size < ASSET_TYPES.length) {
    for (const t of await db.select().from(s.assetType)) typeIds.set(t.name, t.id);
  }

  const [campusRow] = await db
    .insert(s.campus)
    .values({ name: spec.name, district: spec.district })
    .returning();
  const campusId = campusRow!.id;

  const insertAssets = async (
    specs: AssetSpec[] | undefined,
    loc: { buildingId: string; floorId?: string; roomId?: string },
  ) => {
    if (!specs?.length) return;
    const rows = await db
      .insert(s.asset)
      .values(
        specs.map((a) => {
          const assetTypeId = typeIds.get(a.type);
          if (!assetTypeId) throw new Error(`seed: unknown asset type "${a.type}"`);
          return {
            ...loc,
            assetTypeId,
            label: a.label,
            quantity: a.qty ?? 1,
            condition: a.condition,
            notes: a.notes,
          };
        }),
      )
      .returning();
    await db.insert(s.assetEvent).values(
      rows.map((r) => ({ assetId: r.id, kind: 'created' as const, after: r, actor: SEED_ACTOR })),
    );
  };

  for (const b of spec.buildings) {
    const [bRow] = await db
      .insert(s.building)
      .values({ campusId, code: b.code, name: b.name, yearBuilt: b.yearBuilt })
      .returning();
    const buildingId = bRow!.id;
    await insertAssets(b.assets, { buildingId });

    for (const f of b.floors) {
      const [fRow] = await db.insert(s.floor).values({ buildingId, name: f.name, level: f.level }).returning();
      const floorId = fRow!.id;
      await insertAssets(f.assets, { buildingId, floorId });

      for (const r of f.rooms) {
        const walkedAt = r.walked ? new Date(now.getTime() - r.walked.daysAgo * DAY_MS) : null;
        const [rRow] = await db
          .insert(s.room)
          .values({
            floorId,
            number: r.number,
            name: r.name,
            roomType: r.type,
            walkedAt,
            walkedBy: r.walked?.by ?? null,
          })
          .returning();
        await insertAssets(r.assets, { buildingId, floorId, roomId: rRow!.id });
      }
    }
  }
  return campusId;
}

/** `npm run db:seed` — refuses to double-seed unless RESET=1, which wipes everything first. */
async function main() {
  const handle = createDb();
  await handle.migrate();
  const { db } = handle;

  const existing = await db.select({ id: s.campus.id, name: s.campus.name }).from(s.campus);
  if (existing.length) {
    if (process.env.RESET !== '1') {
      console.log(`database already has ${existing.length} campus(es); run with RESET=1 to wipe and reseed`);
      await handle.close();
      return;
    }
    await db.delete(s.campus); // cascades to buildings, floors, rooms, assets, events, photos
    await db.delete(s.assetType);
  }

  const campusId = await seedCampus(db, CAMPUS);
  const [[rooms], [assets]] = await Promise.all([
    db.select({ n: count() }).from(s.room),
    db.select({ n: count() }).from(s.asset),
  ]);
  console.log(`seeded "${CAMPUS.name}" (${campusId}): ${rooms!.n} rooms, ${assets!.n} assets`);
  await handle.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
