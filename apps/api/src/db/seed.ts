import { pathToFileURL } from 'node:url';
import { count } from 'drizzle-orm';
import { createDb, type Db } from './client.ts';
import * as s from './schema.ts';
import { ASSET_TYPES, CAMPUS, type AssetSpec, type CampusSpec, type SiteInfoSpec } from './seed-data.ts';

const DAY_MS = 86_400_000;

/** Every person named as a walker anywhere in the spec. */
function walkerNames(spec: CampusSpec): string[] {
  const names = new Set<string>();
  for (const b of spec.buildings) {
    names.add(b.walker);
    for (const f of b.floors) for (const r of f.rooms) if (r.walked) names.add(r.walked.by);
  }
  return [...names];
}

/**
 * Loads a campus spec and returns the campus id so tests can seed the same fixture.
 * Every asset gets a `created` event authored by the walker who recorded it, so the audit log
 * convention holds for seeded rows too.
 */
const siteInfo = (i: SiteInfoSpec) => ({
  address: i.address ?? null,
  contactName: i.contactName ?? null,
  contactPhone: i.contactPhone ?? null,
  contactEmail: i.contactEmail ?? null,
});

export async function seedCampus(db: Db, spec: CampusSpec, now = new Date()) {
  await db.insert(s.assetType).values(ASSET_TYPES).onConflictDoNothing();
  const types = await db.select().from(s.assetType);
  const typeIds = new Map(types.map((t) => [t.name, t.id]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  await db.insert(s.user).values(walkerNames(spec).map((name) => ({ name }))).onConflictDoNothing();
  const userIds = new Map((await db.select().from(s.user)).map((u) => [u.name, u.id]));
  const userId = (name: string) => {
    const id = userIds.get(name);
    if (!id) throw new Error(`seed: unknown walker "${name}"`);
    return id;
  };

  const [campusRow] = await db
    .insert(s.campus)
    .values({ name: spec.name, district: spec.district, ...siteInfo(spec) })
    .returning();
  const campusId = campusRow!.id;

  const insertAssets = async (
    specs: AssetSpec[] | undefined,
    loc: { buildingId: string; floorId?: string; roomId?: string },
    actorId: string,
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
    // Same snapshot shape the API writes on create: the row plus its type, minus bookkeeping.
    await db.insert(s.assetEvent).values(
      rows.map(({ assetTypeId, deletedAt: _d, ...r }) => ({
        assetId: r.id,
        kind: 'created' as const,
        after: { ...r, assetType: typeById.get(assetTypeId) },
        changedBy: actorId,
      })),
    );
  };

  for (const b of spec.buildings) {
    const [bRow] = await db
      .insert(s.building)
      .values({ campusId, code: b.code, name: b.name, yearBuilt: b.yearBuilt, ...siteInfo(b) })
      .returning();
    const buildingId = bRow!.id;
    const buildingWalker = userId(b.walker);
    await insertAssets(b.assets, { buildingId }, buildingWalker);

    for (const f of b.floors) {
      const [fRow] = await db.insert(s.floor).values({ buildingId, name: f.name, level: f.level }).returning();
      const floorId = fRow!.id;
      await insertAssets(f.assets, { buildingId, floorId }, buildingWalker);

      for (const r of f.rooms) {
        const walkedById = r.walked ? userId(r.walked.by) : null;
        const [rRow] = await db
          .insert(s.room)
          .values({
            floorId,
            number: r.number,
            name: r.name,
            roomType: r.type,
            walkedAt: r.walked ? new Date(now.getTime() - r.walked.daysAgo * DAY_MS) : null,
            walkedById,
          })
          .returning();
        await insertAssets(r.assets, { buildingId, floorId, roomId: rRow!.id }, walkedById ?? buildingWalker);
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

  const existing = await db.select({ id: s.campus.id }).from(s.campus);
  if (existing.length) {
    if (process.env.RESET !== '1') {
      console.log(`database already has ${existing.length} campus(es); run with RESET=1 to wipe and reseed`);
      await handle.close();
      return;
    }
    await db.delete(s.campus); // cascades to buildings, floors, rooms, assets, events, photos
    await db.delete(s.assetType);
    await db.delete(s.user);
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
