import { and, eq, inArray, isNull } from 'drizzle-orm';
import { IMAGE_CONTENT_TYPES, type AiSuggestion, type CreatePhotoInput, type ImageContentType } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { newPhotoKey, PHOTO_KEY, URL_TTL_SECONDS, type PhotoStorage } from '../storage.ts';
import type { Suggester } from '../suggest.ts';
import { getAsset } from './assets.ts';

export interface PhotoView {
  id: string;
  assetId: string | null;
  roomId: string | null;
  url: string;
  suggestion: AiSuggestion | null;
  createdAt: Date;
}

/** Step 1 of the field flow: the phone asks for somewhere to PUT the photo. */
export async function createUpload(storage: PhotoStorage, contentType: ImageContentType) {
  const key = newPhotoKey(contentType);
  return { key, url: await storage.presignUpload(key, contentType), expiresInSeconds: URL_TTL_SECONDS };
}

async function toView(storage: PhotoStorage, row: typeof s.photo.$inferSelect): Promise<PhotoView> {
  return {
    id: row.id,
    assetId: row.assetId,
    roomId: row.roomId,
    url: await storage.presignDownload(row.s3Key),
    suggestion: (row.aiSuggestion as AiSuggestion | null) ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Step 2: once the PUT finished, record the object as a photo and ask the model about it.
 * The suggestion is stored with the photo so the office can later see what was proposed
 * versus what the walker chose.
 */
export async function createPhoto(
  db: Db,
  storage: PhotoStorage,
  suggester: Suggester,
  input: CreatePhotoInput,
): Promise<PhotoView> {
  if (!PHOTO_KEY.test(input.s3Key)) throw badRequest('unknown upload key');
  const [existing] = await db.select({ id: s.photo.id }).from(s.photo).where(eq(s.photo.s3Key, input.s3Key));
  if (existing) throw badRequest('photo already recorded for this upload');
  if (input.assetId && !(await getAsset(db, input.assetId))) throw notFound('asset');
  if (input.roomId) {
    const [room] = await db.select({ id: s.room.id }).from(s.room).where(eq(s.room.id, input.roomId));
    if (!room) throw notFound('room');
  }

  const object = await storage.get(input.s3Key);
  if (!object) throw badRequest('upload not found; PUT the file to the upload URL first');
  const contentType = IMAGE_CONTENT_TYPES.find((t) => t === object.contentType);
  if (!contentType) throw badRequest(`unsupported image type ${object.contentType}`);

  const assetTypes = await db
    .select({ id: s.assetType.id, name: s.assetType.name, category: s.assetType.category })
    .from(s.assetType);
  const suggestion = await suggester.suggest({ bytes: object.bytes, contentType, assetTypes });

  const [row] = await db
    .insert(s.photo)
    .values({ assetId: input.assetId ?? null, roomId: input.roomId ?? null, s3Key: input.s3Key, aiSuggestion: suggestion })
    .returning();
  return toView(storage, row!);
}

export async function getPhoto(db: Db, storage: PhotoStorage, id: string): Promise<PhotoView | null> {
  const [row] = await db.select().from(s.photo).where(eq(s.photo.id, id));
  return row ? toView(storage, row) : null;
}

/** Photos of the room itself (not of its assets), oldest first. */
export async function photosByRoom(db: Db, storage: PhotoStorage, roomId: string): Promise<PhotoView[]> {
  const rows = await db.select().from(s.photo).where(eq(s.photo.roomId, roomId)).orderBy(s.photo.createdAt);
  return Promise.all(rows.map((row) => toView(storage, row)));
}

/** Photos for a set of assets in one query, keyed by asset id. */
export async function photosByAsset(db: Db, storage: PhotoStorage, assetIds: string[]) {
  const out = new Map<string, PhotoView[]>();
  if (assetIds.length === 0) return out;
  const rows = await db.select().from(s.photo).where(inArray(s.photo.assetId, assetIds)).orderBy(s.photo.createdAt);
  for (const row of rows) {
    const list = out.get(row.assetId!) ?? [];
    list.push(await toView(storage, row));
    out.set(row.assetId!, list);
  }
  return out;
}

/** Adds `photos` to each asset in a listing. */
export async function withPhotos<T extends { id: string }>(db: Db, storage: PhotoStorage, assets: T[]) {
  const photos = await photosByAsset(
    db,
    storage,
    assets.map((a) => a.id),
  );
  return assets.map((a) => ({ ...a, photos: photos.get(a.id) ?? [] }));
}

/**
 * Attaches photos taken before the asset existed. All must be unattached; otherwise the
 * whole create fails rather than silently dropping one.
 */
export async function attachPhotos(db: Db, assetId: string, photoIds: string[]) {
  if (photoIds.length === 0) return;
  const rows = await db
    .update(s.photo)
    .set({ assetId })
    .where(and(inArray(s.photo.id, photoIds), isNull(s.photo.assetId), isNull(s.photo.roomId)))
    .returning({ id: s.photo.id });
  if (rows.length !== new Set(photoIds).size) throw badRequest('a photo was not found or is already attached');
}

export async function deletePhoto(db: Db, storage: PhotoStorage, id: string) {
  const [row] = await db.delete(s.photo).where(eq(s.photo.id, id)).returning({ s3Key: s.photo.s3Key });
  if (!row) throw notFound('photo');
  // The record is gone either way; an orphaned object is cheap and a failed delete should not surface as an error.
  await storage.delete(row.s3Key).catch((err) => console.warn(`could not delete ${row.s3Key}`, err));
}
