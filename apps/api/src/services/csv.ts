import { and, eq, isNull } from 'drizzle-orm';
import { conditionLabel, ROOM_CSV_COLUMNS, RoomImportRow } from '@campus-walk/shared';
import { parseCsvObjects, toCsv } from '../csv.ts';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';

async function requireCampus(db: Db, campusId: string) {
  const [campus] = await db.select().from(s.campus).where(eq(s.campus.id, campusId));
  if (!campus) throw notFound('campus');
  return campus;
}

/** Every live asset on the campus with its full location, one row per record (furniture rows carry a quantity). */
export async function exportAssetsCsv(db: Db, campusId: string): Promise<string> {
  await requireCampus(db, campusId);
  const rows = await db
    .select({
      id: s.asset.id,
      buildingCode: s.building.code,
      buildingName: s.building.name,
      floorLevel: s.floor.level,
      floorName: s.floor.name,
      roomNumber: s.room.number,
      roomName: s.room.name,
      type: s.assetType.name,
      category: s.assetType.category,
      label: s.asset.label,
      quantity: s.asset.quantity,
      condition: s.asset.condition,
      manufacturer: s.asset.manufacturer,
      model: s.asset.model,
      serialNumber: s.asset.serialNumber,
      installYear: s.asset.installYear,
      notes: s.asset.notes,
      updatedAt: s.asset.updatedAt,
    })
    .from(s.asset)
    .innerJoin(s.assetType, eq(s.asset.assetTypeId, s.assetType.id))
    .innerJoin(s.assetCategory, eq(s.assetType.category, s.assetCategory.key))
    .innerJoin(s.building, eq(s.asset.buildingId, s.building.id))
    .leftJoin(s.floor, eq(s.asset.floorId, s.floor.id))
    .leftJoin(s.room, eq(s.asset.roomId, s.room.id))
    .where(and(eq(s.building.campusId, campusId), isNull(s.asset.deletedAt)))
    .orderBy(s.building.code, s.floor.level, s.room.number, s.assetCategory.sortOrder, s.assetType.name, s.asset.label);

  return toCsv(
    ['building_code', 'building_name', 'floor_level', 'floor_name', 'room_number', 'room_name', 'asset_type', 'category', 'label', 'quantity', 'condition', 'condition_label', 'notes', 'manufacturer', 'model', 'serial_number', 'install_year', 'updated_at', 'asset_id'],
    rows.map((r) => [
      r.buildingCode, r.buildingName, r.floorLevel, r.floorName, r.roomNumber, r.roomName,
      r.type, r.category, r.label, r.quantity, r.condition, conditionLabel(r.condition), r.notes, r.manufacturer, r.model, r.serialNumber, r.installYear, r.updatedAt, r.id,
    ]),
  );
}

/** Rooms in the import format, so the export doubles as the template for edits. */
export async function exportRoomsCsv(db: Db, campusId: string): Promise<string> {
  await requireCampus(db, campusId);
  const rows = await db
    .select({
      buildingCode: s.building.code,
      buildingName: s.building.name,
      floorLevel: s.floor.level,
      floorName: s.floor.name,
      roomNumber: s.room.number,
      roomName: s.room.name,
      roomType: s.room.roomType,
      walkedAt: s.room.walkedAt,
    })
    .from(s.room)
    .innerJoin(s.floor, eq(s.room.floorId, s.floor.id))
    .innerJoin(s.building, eq(s.floor.buildingId, s.building.id))
    .where(eq(s.building.campusId, campusId))
    .orderBy(s.building.code, s.floor.level, s.room.number);
  return toCsv(
    [...ROOM_CSV_COLUMNS, 'walked_at'],
    rows.map((r) => [r.buildingCode, r.buildingName, r.floorLevel, r.floorName, r.roomNumber, r.roomName, r.roomType, r.walkedAt]),
  );
}

const MAX_IMPORT_ROWS = 5_000;

export interface ImportResult {
  rows: number;
  buildings: { created: number };
  floors: { created: number };
  rooms: { created: number; updated: number };
}

/**
 * All-or-nothing: every row is validated before anything is written, and the writes run in
 * one transaction, so a typo on line 40 never leaves half a building behind.
 */
export async function importRoomsCsv(db: Db, campusId: string, text: string): Promise<ImportResult> {
  await requireCampus(db, campusId);

  let parsed: ReturnType<typeof parseCsvObjects>;
  try {
    parsed = parseCsvObjects(text, ROOM_CSV_COLUMNS);
  } catch (err) {
    throw badRequest(`could not read CSV: ${(err as Error).message}`);
  }
  if (parsed.length === 0) throw badRequest('no rows to import');
  if (parsed.length > MAX_IMPORT_ROWS) throw badRequest(`too many rows (max ${MAX_IMPORT_ROWS})`);

  const errors: { line: number; message: string }[] = [];
  const rows: { line: number; row: RoomImportRow }[] = [];
  const seen = new Set<string>();
  for (const { line, row } of parsed) {
    const result = RoomImportRow.safeParse(row);
    if (!result.success) {
      errors.push(...result.error.issues.map((i) => ({ line, message: `${i.path.join('.')}: ${i.message}` })));
      continue;
    }
    const key = `${result.data.building_code}\u0000${result.data.floor_level}\u0000${result.data.room_number}`;
    if (seen.has(key)) errors.push({ line, message: `duplicate room ${result.data.room_number} in ${result.data.building_code} level ${result.data.floor_level}` });
    seen.add(key);
    rows.push({ line, row: result.data });
  }
  if (errors.length) throw badRequest('import has errors; nothing was written', errors);

  return db.transaction(async (tx) => {
    const result: ImportResult = { rows: rows.length, buildings: { created: 0 }, floors: { created: 0 }, rooms: { created: 0, updated: 0 } };
    const buildings = new Map((await tx.select().from(s.building).where(eq(s.building.campusId, campusId))).map((b) => [b.code, b]));
    const floors = new Map<string, typeof s.floor.$inferSelect>();
    for (const b of buildings.values()) {
      for (const f of await tx.select().from(s.floor).where(eq(s.floor.buildingId, b.id))) floors.set(`${b.id}:${f.level}`, f);
    }

    for (const { row } of rows) {
      let building = buildings.get(row.building_code);
      if (!building) {
        [building] = await tx
          .insert(s.building)
          .values({ campusId, code: row.building_code, name: row.building_name || `Building ${row.building_code}` })
          .returning();
        buildings.set(row.building_code, building!);
        result.buildings.created++;
      }
      const floorKey = `${building!.id}:${row.floor_level}`;
      let floor = floors.get(floorKey);
      if (!floor) {
        [floor] = await tx
          .insert(s.floor)
          .values({ buildingId: building!.id, level: row.floor_level, name: row.floor_name || `Floor ${row.floor_level}` })
          .returning();
        floors.set(floorKey, floor!);
        result.floors.created++;
      }
      const [existing] = await tx
        .select({ id: s.room.id })
        .from(s.room)
        .where(and(eq(s.room.floorId, floor!.id), eq(s.room.number, row.room_number)));
      const name = row.room_name || row.room_number;
      if (existing) {
        await tx.update(s.room).set({ name, roomType: row.room_type }).where(eq(s.room.id, existing.id));
        result.rooms.updated++;
      } else {
        await tx.insert(s.room).values({ floorId: floor!.id, number: row.room_number, name, roomType: row.room_type });
        result.rooms.created++;
      }
    }
    return result;
  });
}
