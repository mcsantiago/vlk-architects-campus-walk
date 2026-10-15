import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AiSuggestion, CreatePhotoInput, ImageContentType, PhotoSubjectKind } from '@campus-walk/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { newPhotoKey, photoKeySubject, URL_TTL_SECONDS, type PhotoStorage } from '../storage.ts';
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

/**
 * The API never decodes an image (the browser resizes, the model reads), so the checks here are
 * what the first bytes say the file is, and how big it is. 10 MB is far above the ~300 KB the
 * web app produces and below anything that should sit in memory per request.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** The image type the bytes actually are, from their signature, or null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Step 1 of the field flow: the phone asks for somewhere to PUT the photo. */
export async function createUpload(storage: PhotoStorage, subject: PhotoSubjectKind, contentType: ImageContentType) {
  const key = newPhotoKey(subject, contentType);
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
 * The photo row is written before the model is asked, so a slow or failing model (or a
 * crash mid-call) can never lose the walker's photo; the suggestion is added when it arrives.
 * It is stored with the photo so the office can later see what was proposed versus what the
 * walker chose.
 */
export async function createPhoto(
  db: Db,
  storage: PhotoStorage,
  suggester: Suggester,
  input: CreatePhotoInput,
): Promise<PhotoView> {
  const subject = photoKeySubject(input.s3Key);
  if (!subject) throw badRequest('unknown upload key');
  // The prefix was chosen at upload time; a room photo filed under assets (or the reverse) would
  // put the wrong picture in that set, so the record has to agree with it.
  if ((subject === 'room') !== Boolean(input.roomId)) {
    throw badRequest(subject === 'room' ? 'this upload is for a room photo; send roomId' : 'this upload is for an asset photo; it cannot be a room photo');
  }
  const [existing] = await db.select({ id: s.photo.id }).from(s.photo).where(eq(s.photo.s3Key, input.s3Key));
  if (existing) throw badRequest('photo already recorded for this upload');
  if (input.assetId && !(await getAsset(db, input.assetId))) throw notFound('asset');
  if (input.roomId) {
    const [room] = await db.select({ id: s.room.id }).from(s.room).where(eq(s.room.id, input.roomId));
    if (!room) throw notFound('room');
  }

  const object = await storage.get(input.s3Key, MAX_PHOTO_BYTES + 1);
  if (!object) throw badRequest('upload not found; PUT the file to the upload URL first');
  if (object.bytes.byteLength > MAX_PHOTO_BYTES) throw badRequest(`image is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
  const contentType = sniffImageType(object.bytes);
  if (!contentType) throw badRequest('upload is not a JPEG, PNG or WebP image');
  if (object.contentType !== contentType) throw badRequest(`upload is ${contentType} but was sent as ${object.contentType}`);

  // Everything that can fail for a good reason happens before the insert; after it, only the model.
  const assetTypes = await db
    .select({ id: s.assetType.id, name: s.assetType.name, category: s.assetType.category })
    .from(s.assetType);
  const [inserted] = await db
    .insert(s.photo)
    .values({ assetId: input.assetId ?? null, roomId: input.roomId ?? null, s3Key: input.s3Key, aiSuggestion: null })
    .returning();
  // A Suggester is expected to return null on failure; this guards one that throws anyway.
  const suggestion = await suggester.suggest({ bytes: object.bytes, contentType, assetTypes }).catch((err: unknown) => {
    console.warn('suggestion failed', err);
    return null;
  });
  if (!suggestion) return toView(storage, inserted!);
  // The photo is already saved; losing the suggestion is a warning, not a failed request.
  const [row] = await db
    .update(s.photo)
    .set({ aiSuggestion: suggestion })
    .where(eq(s.photo.id, inserted!.id))
    .returning()
    .catch((err: unknown) => {
      console.warn('could not store the suggestion', err);
      return [inserted!];
    });
  return toView(storage, row ?? inserted!);
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
