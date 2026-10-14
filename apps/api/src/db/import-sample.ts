import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { parseCsv } from '../csv.ts';
import { findOrCreateAssetType } from '../services/types.ts';
import { createDb, type Db } from './client.ts';
import * as s from './schema.ts';

/**
 * Loads a district's existing inventory, in the CSV layout VLK supplied with the brief
 * (data/sample), as the starting point for a walk. The walk then verifies what is on the
 * books instead of building the list from nothing: rows the district has rated keep their
 * rating and the person who gave it; rows in rooms nobody has reached yet come in unrated.
 * Nothing is attributed that the source does not say: a room's walked date is kept, but the
 * walk is credited to the import, since the files do not record who walked it.
 *
 * The files are taken as data, not as a schema we own: only the columns needed to place a row
 * are required, extra columns are ignored, room types are stored as written, and a category is
 * matched against the asset_category table (by key, name or a common synonym); one we have no
 * row for falls back to equipment with a note rather than stopping the import. Only a
 * broken reference (a room on the wrong floor, an unknown type) or a value outside the model
 * (a rating of 7) is an error. Everything is validated before anything is written and the
 * writes run in one transaction. A campus whose name is already in the database is skipped,
 * so running it twice is safe.
 */

const SAMPLE_DIR = new URL('../../../../data/sample/', import.meta.url);

/**
 * Inventory wording for categories, onto category keys. Only consulted when the word is not
 * already a category's key or name, and only used if that key exists in asset_category.
 */
const CATEGORY_SYNONYMS: Record<string, string> = {
  furnishings: 'furniture',
  tech: 'technology',
  it: 'technology',
  av: 'technology',
  'building system': 'system',
  'building systems': 'system',
  systems: 'system',
  mep: 'system',
};
/** Where an unrecognised category goes, if the table has it; otherwise the last category by sort order. */
const FALLBACK_CATEGORY = 'equipment';

type Category = typeof s.assetCategory.$inferSelect;
const normalise = (text: string) => text.trim().toLowerCase().replace(/[_-]+/g, ' ');

/** Matches inventory wording to a category row: key, then name, then synonym. */
function categoryMatcher(categories: Category[]) {
  const byWord = new Map<string, Category>();
  for (const c of categories) {
    byWord.set(normalise(c.key), c);
    byWord.set(normalise(c.name), c);
  }
  for (const [word, key] of Object.entries(CATEGORY_SYNONYMS)) {
    const c = categories.find((x) => x.key === key);
    if (c && !byWord.has(word)) byWord.set(word, c);
  }
  const fallback = categories.find((c) => c.key === FALLBACK_CATEGORY) ?? categories[categories.length - 1];
  return { match: (text: string) => byWord.get(normalise(text)), fallback };
}

/** Sample dates are calendar days in Texas; noon Central keeps them on that day in any display zone. */
const texasNoon = (day: string) => new Date(`${day}T12:00:00-05:00`);

/** Required columns place a row; optional ones enrich it and may be absent or added to freely. */
const FILES = {
  campuses: { required: ['campus_id', 'name'], optional: ['district_id', 'address'] },
  buildings: { required: ['building_id', 'campus_id', 'name'], optional: ['year_built'] },
  floors: { required: ['floor_id', 'building_id', 'level'], optional: ['name'] },
  rooms: { required: ['room_id', 'floor_id', 'room_number'], optional: ['building_id', 'room_name', 'room_type', 'walked_on'] },
  asset_types: { required: ['asset_type_id', 'name'], optional: ['category'] },
  assets: {
    required: ['asset_type_id', 'building_id'],
    optional: ['asset_id', 'asset_tag', 'campus_id', 'floor_id', 'room_id', 'quantity', 'manufacturer', 'model', 'serial_number', 'install_year', 'condition_rating', 'condition_notes', 'last_assessed_on', 'assessed_by'],
  },
} as const;

type FileName = keyof typeof FILES;
type Row<F extends FileName> = Record<(typeof FILES)[F]['required'][number] | (typeof FILES)[F]['optional'][number], string>;

/** Header-mapped rows; missing optional columns read as '', unknown columns are ignored. */
async function readRows<F extends FileName>(dir: URL, file: F) {
  const text = await readFile(new URL(`${file}.csv`, dir), 'utf8');
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error(`${file}.csv is empty`);
  const names = header.values.map((h) => h.trim().toLowerCase());
  const { required, optional } = FILES[file];
  const missing = required.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`${file}.csv is missing columns: ${missing.join(', ')}`);
  const columns = [...required, ...optional];
  return body.map(({ line, values }) => ({
    line,
    row: Object.fromEntries(columns.map((c) => [c, (values[names.indexOf(c)] ?? '').trim()])) as Row<F>,
  }));
}

export interface ImportSummary {
  campuses: { name: string; id: string; buildings: number; rooms: number; assets: number; unrated: number }[];
  skipped: string[];
  typesCreated: number;
  /** Rows that imported with a fallback, e.g. a room type we have no name for. */
  notes: string[];
}

export async function importInventory(db: Db, dir: URL = SAMPLE_DIR, now = new Date()): Promise<ImportSummary> {
  const [campuses, buildings, floors, rooms, types, assets] = await Promise.all([
    readRows(dir, 'campuses'),
    readRows(dir, 'buildings'),
    readRows(dir, 'floors'),
    readRows(dir, 'rooms'),
    readRows(dir, 'asset_types'),
    readRows(dir, 'assets'),
  ]);
  const district = await districtName(dir);
  const categories = await db.select().from(s.assetCategory).orderBy(s.assetCategory.sortOrder);
  if (!categories.length) throw new Error('inventory import refused: the asset_category table is empty');
  const category = categoryMatcher(categories);

  // --- validate every reference before touching the database -----------------------------
  const errors: string[] = [];
  const notes: string[] = [];

  // Source ids are the only way rows refer to each other, so a repeated id would silently
  // re-point everything that references it (the last row would win). Refuse instead, naming
  // both lines. The same goes for the natural keys the database holds unique, and for asset
  // tags, which identify one physical item.
  const unique = <R,>(file: string, what: string, rows: { line: number; row: R }[], key: (r: R) => string) => {
    const first = new Map<string, number>();
    for (const { line, row } of rows) {
      const k = key(row);
      if (!k) continue;
      const seen = first.get(k);
      if (seen === undefined) first.set(k, line);
      else errors.push(`${file}:${line} duplicate ${what} ${k.replaceAll('\u0000', ' / ')} (first on line ${seen})`);
    }
  };
  unique('campuses.csv', 'campus_id', campuses, (r) => r.campus_id);
  unique('campuses.csv', 'campus name', campuses, (r) => r.name.toLowerCase());
  unique('buildings.csv', 'building_id', buildings, (r) => r.building_id);
  unique('floors.csv', 'floor_id', floors, (r) => r.floor_id);
  unique('floors.csv', 'building and level', floors, (r) => `${r.building_id}\u0000${r.level}`);
  unique('rooms.csv', 'room_id', rooms, (r) => r.room_id);
  unique('rooms.csv', 'floor and room number', rooms, (r) => `${r.floor_id}\u0000${r.room_number.toLowerCase()}`);
  unique('asset_types.csv', 'asset_type_id', types, (r) => r.asset_type_id);
  unique('assets.csv', 'asset_id', assets, (r) => r.asset_id);
  unique('assets.csv', 'asset_tag', assets, (r) => r.asset_tag);
  // Two source types with one name would become one catalogue type; say so rather than merge quietly.
  const typeNames = new Map<string, number>();
  for (const { line, row } of types) {
    const seen = typeNames.get(row.name.trim().toLowerCase());
    if (seen !== undefined) notes.push(`asset_types.csv:${line} ${row.name} has the same name as line ${seen}; both become one type`);
    else typeNames.set(row.name.trim().toLowerCase(), line);
  }

  const campusById = new Map(campuses.map((c) => [c.row.campus_id, c.row]));
  const buildingById = new Map(buildings.map((b) => [b.row.building_id, b.row]));
  const floorById = new Map(floors.map((f) => [f.row.floor_id, f.row]));
  const roomById = new Map(rooms.map((r) => [r.row.room_id, r.row]));
  const typeById = new Map(types.map((t) => [t.row.asset_type_id, t.row]));

  for (const { line, row } of buildings) if (!campusById.has(row.campus_id)) errors.push(`buildings.csv:${line} unknown campus ${row.campus_id}`);
  for (const { line, row } of floors) {
    if (!buildingById.has(row.building_id)) errors.push(`floors.csv:${line} unknown building ${row.building_id}`);
    if (!/^-?\d+$/.test(row.level)) errors.push(`floors.csv:${line} level must be a whole number, got "${row.level}"`);
  }
  for (const { line, row } of rooms) {
    const floor = floorById.get(row.floor_id);
    if (!floor) errors.push(`rooms.csv:${line} unknown floor ${row.floor_id}`);
    else if (row.building_id && floor.building_id !== row.building_id) errors.push(`rooms.csv:${line} floor ${row.floor_id} is not in ${row.building_id}`);
    if (!row.room_type) notes.push(`rooms.csv:${line} room ${row.room_number} has no type; recorded as "other"`);
    if (row.walked_on && Number.isNaN(texasNoon(row.walked_on).getTime())) errors.push(`rooms.csv:${line} bad walked_on ${row.walked_on}`);
  }
  for (const { line, row } of types)
    if (!category.match(row.category))
      notes.push(`asset_types.csv:${line} category "${row.category}" for ${row.name} is not one of ours; recorded as ${category.fallback!.key}`);
  const maxQuantity = new Map<string, number>();
  for (const { line, row } of assets) {
    const where = `assets.csv:${line}${row.asset_id ? ` (${row.asset_id})` : ''}`;
    if (!typeById.has(row.asset_type_id)) errors.push(`${where} unknown type ${row.asset_type_id}`);
    const building = buildingById.get(row.building_id);
    if (!building) errors.push(`${where} unknown building ${row.building_id}`);
    else if (row.campus_id && building.campus_id !== row.campus_id) errors.push(`${where} building ${row.building_id} is not on ${row.campus_id}`);
    if (row.floor_id) {
      const floor = floorById.get(row.floor_id);
      if (!floor) errors.push(`${where} unknown floor ${row.floor_id}`);
      else if (floor.building_id !== row.building_id) errors.push(`${where} floor ${row.floor_id} is not in ${row.building_id}`);
    }
    if (row.room_id) {
      const room = roomById.get(row.room_id);
      if (!room) errors.push(`${where} unknown room ${row.room_id}`);
      else if (room.floor_id !== row.floor_id) errors.push(`${where} room ${row.room_id} is not on ${row.floor_id || 'a floor'}`);
    }
    const quantity = Number(row.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1) errors.push(`${where} bad quantity ${row.quantity}`);
    maxQuantity.set(row.asset_type_id, Math.max(maxQuantity.get(row.asset_type_id) ?? 1, quantity));
    if (row.condition_rating && !/^[1-5]$/.test(row.condition_rating)) errors.push(`${where} bad condition ${row.condition_rating}`);
    if (row.install_year && !/^\d{4}$/.test(row.install_year)) errors.push(`${where} bad install_year ${row.install_year}`);
    if (row.last_assessed_on && Number.isNaN(texasNoon(row.last_assessed_on).getTime())) errors.push(`${where} bad last_assessed_on`);
    if (!!row.condition_rating !== !!row.assessed_by) errors.push(`${where} condition and assessed_by must come together`);
  }
  if (errors.length) throw new Error(`inventory import refused:\n  ${errors.join('\n  ')}`);

  return db.transaction(async (tx) => {
    const summary: ImportSummary = { campuses: [], skipped: [], typesCreated: 0, notes };

    // Walkers: the people who assessed anything, plus the import itself, which is credited
    // with every walked room and every row nobody has rated.
    const importWalker = `${district} (import)`;
    const walkerNames = new Set<string>([importWalker]);
    for (const { row } of assets) if (row.assessed_by) walkerNames.add(row.assessed_by);
    await tx.insert(s.user).values([...walkerNames].map((name) => ({ name }))).onConflictDoNothing();
    const users = await tx.select().from(s.user);
    const userId = (name: string) => users.find((u) => u.name.toLowerCase() === name.toLowerCase())!.id;

    // Types: the category's default decides counted vs one-per-unit, except that a type the
    // inventory itself counts (a lab of 30 desktops in one row) is always counted.
    const before = (await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(s.assetType))[0]!.n;
    const typeRowId = new Map<string, string>();
    const typeInfo = new Map<string, typeof s.assetType.$inferSelect>();
    for (const { row } of types) {
      const cat = category.match(row.category) ?? category.fallback!;
      const type = await findOrCreateAssetType(tx, {
        name: row.name,
        category: cat.key,
        trackedIndividually: cat.trackedByDefault && (maxQuantity.get(row.asset_type_id) ?? 1) === 1,
      });
      typeRowId.set(row.asset_type_id, type.id);
      typeInfo.set(row.asset_type_id, type);
    }
    summary.typesCreated = (await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(s.assetType))[0]!.n - before;

    const existing = await tx.select({ name: s.campus.name }).from(s.campus);
    const taken = new Set(existing.map((c) => c.name.toLowerCase()));

    for (const { row: c } of campuses) {
      if (taken.has(c.name.toLowerCase())) {
        summary.skipped.push(c.name);
        continue;
      }
      const [campusRow] = await tx.insert(s.campus).values({ name: c.name, district, address: c.address || null }).returning();
      const campusId = campusRow!.id;
      const counts = { name: c.name, id: campusId, buildings: 0, rooms: 0, assets: 0, unrated: 0 };

      const buildingIds = new Map<string, string>();
      const floorIds = new Map<string, string>();
      const roomIds = new Map<string, string>();
      for (const { row: b } of buildings.filter((b) => b.row.campus_id === c.campus_id)) {
        const [bRow] = await tx
          .insert(s.building)
          .values({ campusId, code: b.building_id, name: b.name, yearBuilt: /^\d{4}$/.test(b.year_built) ? Number(b.year_built) : null })
          .returning();
        buildingIds.set(b.building_id, bRow!.id);
        counts.buildings++;
        for (const { row: f } of floors.filter((f) => f.row.building_id === b.building_id)) {
          const [fRow] = await tx.insert(s.floor).values({ buildingId: bRow!.id, level: Number(f.level), name: f.name || `Level ${f.level}` }).returning();
          floorIds.set(f.floor_id, fRow!.id);
          for (const { row: r } of rooms.filter((r) => r.row.floor_id === f.floor_id)) {
            const walkedAt = r.walked_on ? texasNoon(r.walked_on) : null;
            const [rRow] = await tx
              .insert(s.room)
              .values({
                floorId: fRow!.id,
                number: r.room_number,
                name: r.room_name || r.room_number,
                roomType: r.room_type || 'other',
                walkedAt,
                // The source says when a room was walked, not by whom. Credit the import rather
                // than guess an architect; each asset's own history keeps its real assessor.
                walkedById: walkedAt ? userId(importWalker) : null,
              })
              .returning();
            roomIds.set(r.room_id, rRow!.id);
            counts.rooms++;
          }
        }
      }

      const mine = assets.filter((a) => buildingById.get(a.row.building_id)!.campus_id === c.campus_id);
      for (let i = 0; i < mine.length; i += 200) {
        const chunk = mine.slice(i, i + 200);
        const rows = await tx
          .insert(s.asset)
          .values(
            chunk.map(({ row: a }) => {
              const at = a.last_assessed_on ? texasNoon(a.last_assessed_on) : now;
              return {
                buildingId: buildingIds.get(a.building_id)!,
                floorId: a.floor_id ? floorIds.get(a.floor_id)! : null,
                roomId: a.room_id ? roomIds.get(a.room_id)! : null,
                assetTypeId: typeRowId.get(a.asset_type_id)!,
                label: a.asset_tag || null,
                quantity: Number(a.quantity || 1),
                condition: a.condition_rating ? Number(a.condition_rating) : null,
                notes: a.condition_notes || null,
                manufacturer: a.manufacturer || null,
                model: a.model || null,
                serialNumber: a.serial_number || null,
                installYear: a.install_year ? Number(a.install_year) : null,
                createdAt: at,
                updatedAt: at,
              };
            }),
          )
          .returning();
        // The same `created` snapshot the API writes, credited to whoever assessed the row and dated to when.
        await tx.insert(s.assetEvent).values(
          rows.map(({ assetTypeId, deletedAt: _d, ...r }, j) => {
            const a = chunk[j]!.row;
            const { id: _tid, ...type } = typeInfo.get(a.asset_type_id)!;
            return {
              assetId: r.id,
              kind: 'created' as const,
              after: { ...r, assetType: { id: assetTypeId, ...type } },
              changedBy: userId(a.assessed_by || importWalker),
              changedAt: r.createdAt,
            };
          }),
        );
        counts.assets += rows.length;
        counts.unrated += rows.filter((r) => r.condition === null).length;
      }
      summary.campuses.push(counts);
    }
    return summary;
  });
}

/** The district's name is only in the nested JSON copy of the data; fall back to its id. */
async function districtName(dir: URL): Promise<string> {
  try {
    const json = JSON.parse(await readFile(new URL('campus_walk_sample.json', dir), 'utf8')) as { name?: string; district_id?: string };
    return json.name ?? json.district_id ?? 'District';
  } catch {
    return 'District';
  }
}

/** `npm run db:import-sample [dir]` — loads the sample inventory next to whatever is already there. */
async function main() {
  const handle = createDb();
  await handle.migrate();
  const dir = process.argv[2] ? pathToFileURL(process.argv[2].replace(/\/?$/, '/')) : SAMPLE_DIR;
  const result = await importInventory(handle.db, dir);
  for (const c of result.campuses)
    console.log(`imported "${c.name}" (${c.id}): ${c.buildings} buildings, ${c.rooms} rooms, ${c.assets} assets (${c.unrated} not yet rated)`);
  for (const name of result.skipped) console.log(`skipped "${name}": already in the database`);
  for (const note of result.notes) console.log(`note: ${note}`);
  console.log(`${result.typesCreated} asset type(s) added to the catalogue`);
  await handle.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
