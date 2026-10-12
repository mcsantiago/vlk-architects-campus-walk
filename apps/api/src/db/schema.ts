import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ASSET_CATEGORIES } from '@campus-walk/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A person who walks campuses. Identity only, no credentials: the client picks a user and sends
 * its id on each write. Authentication and roles are a later concern and would hang off this table.
 * Named app_user because `user` is reserved in Postgres.
 */
export const user = pgTable(
  'app_user',
  {
    id: id(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('app_user_name_lower_uq').on(sql`lower(${t.name})`)],
);

/** Site address and a point of contact, shown on the campus and building screens. All optional. */
const siteInfo = {
  address: text('address'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
};

export const campus = pgTable('campus', {
  id: id(),
  name: text('name').notNull(),
  district: text('district').notNull(),
  ...siteInfo,
  createdAt: createdAt(),
});

export const building = pgTable(
  'building',
  {
    id: id(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campus.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    yearBuilt: integer('year_built'),
    ...siteInfo,
    createdAt: createdAt(),
  },
  (t) => [unique('building_campus_code_uq').on(t.campusId, t.code)],
);

export const floor = pgTable(
  'floor',
  {
    id: id(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => building.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Sort order within the building: 1 = ground floor, negative = basement. */
    level: integer('level').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('floor_building_level_uq').on(t.buildingId, t.level),
    // Target for asset's composite FK (floor_id, building_id).
    unique('floor_id_building_uq').on(t.id, t.buildingId),
  ],
);

export const room = pgTable(
  'room',
  {
    id: id(),
    floorId: uuid('floor_id')
      .notNull()
      .references(() => floor.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    name: text('name').notNull(),
    roomType: text('room_type').notNull(),
    /** Null until a walker marks the room complete. A room with zero assets can still be walked. */
    walkedAt: timestamp('walked_at', { withTimezone: true }),
    walkedById: uuid('walked_by_id').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('room_floor_number_uq').on(t.floorId, t.number),
    // Target for asset's composite FK (room_id, floor_id).
    unique('room_id_floor_uq').on(t.id, t.floorId),
    check('room_walked_by_ck', sql`(${t.walkedAt} IS NULL) = (${t.walkedById} IS NULL)`),
  ],
);

export const assetType = pgTable(
  'asset_type',
  {
    id: id(),
    name: text('name').notNull().unique(),
    category: text('category', { enum: ASSET_CATEGORIES }).notNull(),
    /** Equipment/systems are tracked one record per unit; furniture is counted via quantity. */
    trackedIndividually: boolean('tracked_individually').notNull(),
  },
  (t) => [
    check(
      'asset_type_category_ck',
      sql`${t.category} IN (${sql.raw(ASSET_CATEGORIES.map((c) => `'${c}'`).join(', '))})`,
    ),
  ],
);

/**
 * An asset always belongs to a building; floor and room optionally narrow its location.
 *   rooftop HVAC  -> building only
 *   corridor FACP -> building + floor
 *   student desks -> building + floor + room
 * The composite FKs below make an inconsistent location (room on another floor, floor in
 * another building) impossible at the database level. Postgres' default MATCH SIMPLE skips
 * a composite FK when any column is NULL, which is exactly the "optional level" semantics.
 */
export const asset = pgTable(
  'asset',
  {
    id: id(),
    buildingId: uuid('building_id').notNull(),
    floorId: uuid('floor_id'),
    roomId: uuid('room_id'),
    assetTypeId: uuid('asset_type_id')
      .notNull()
      .references(() => assetType.id),
    label: text('label'),
    quantity: integer('quantity').notNull().default(1),
    condition: integer('condition').notNull(),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'asset_building_fk',
      columns: [t.buildingId],
      foreignColumns: [building.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'asset_floor_in_building_fk',
      columns: [t.floorId, t.buildingId],
      foreignColumns: [floor.id, floor.buildingId],
    }),
    foreignKey({
      name: 'asset_room_on_floor_fk',
      columns: [t.roomId, t.floorId],
      foreignColumns: [room.id, room.floorId],
    }),
    check('asset_room_needs_floor_ck', sql`${t.roomId} IS NULL OR ${t.floorId} IS NOT NULL`),
    check('asset_condition_ck', sql`${t.condition} BETWEEN 1 AND 5`),
    check('asset_quantity_ck', sql`${t.quantity} >= 1`),
    index('asset_building_idx').on(t.buildingId).where(sql`${t.deletedAt} IS NULL`),
    index('asset_room_idx').on(t.roomId).where(sql`${t.deletedAt} IS NULL`),
  ],
);

/**
 * A photo is of an asset, of a room itself (context shots: the whole room, a wall), or not yet
 * attached (taken before the asset was saved). Never both an asset and a room.
 */
export const photo = pgTable(
  'photo',
  {
    id: id(),
    assetId: uuid('asset_id').references(() => asset.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').references(() => room.id, { onDelete: 'cascade' }),
    /** Object key in the photo bucket; URLs are presigned on read. */
    s3Key: text('s3_key').notNull().unique(),
    aiSuggestion: jsonb('ai_suggestion'),
    createdAt: createdAt(),
  },
  (t) => [
    index('photo_asset_idx').on(t.assetId),
    index('photo_room_idx').on(t.roomId),
    check('photo_one_subject_ck', sql`${t.assetId} IS NULL OR ${t.roomId} IS NULL`),
  ],
);

export const ASSET_EVENT_KINDS = ['created', 'moved', 'updated', 'deleted'] as const;

export const assetEvent = pgTable(
  'asset_event',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ASSET_EVENT_KINDS }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    /** Who made the change: the x-user-id on the request. */
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => user.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('asset_event_asset_idx').on(t.assetId, t.changedAt)],
);
