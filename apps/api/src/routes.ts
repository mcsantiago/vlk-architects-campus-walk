import { Hono } from 'hono';
import {
  CopyAssetInput,
  CreateAssetInput,
  CreatePhotoInput,
  CreateUploadInput,
  CreateUserInput,
  DeleteAssetInput,
  MoveAssetInput,
  UpdateAssetInput,
} from '@campus-walk/shared';
import { requireUser, type Env } from './app.ts';
import * as s from './db/schema.ts';
import { HttpError, idParam, notFound, parseBody } from './errors.ts';
import { copyAsset, createAsset, deleteAsset, getAsset, listAssetEvents, moveAsset, updateAsset } from './services/assets.ts';
import {
  getCampusSummary,
  getCampusTree,
  getRoom,
  listBuildingSystems,
  listCampuses,
  roomHeader,
  setRoomWalked,
} from './services/campus.ts';
import { exportAssetsCsv, exportRoomsCsv, importRoomsCsv } from './services/csv.ts';
import { createPhoto, createUpload, deletePhoto, getPhoto, photosByRoom, withPhotos } from './services/photos.ts';
import { findOrCreateUser, listUsers } from './services/users.ts';

export const routes = new Hono<Env>();

routes.get('/users', async (c) => c.json(await listUsers(c.get('db'))));
routes.post('/users', async (c) => {
  const { name } = await parseBody(c, CreateUserInput);
  return c.json(await findOrCreateUser(c.get('db'), name), 201);
});

routes.get('/campuses', async (c) => c.json(await listCampuses(c.get('db'))));
routes.get('/campuses/:id/tree', async (c) => c.json(await getCampusTree(c.get('db'), idParam(c))));
routes.get('/campuses/:id/summary', async (c) => {
  const buildingId = c.req.query('buildingId');
  return c.json(await getCampusSummary(c.get('db'), idParam(c), buildingId || undefined));
});

const csvResponse = (body: string, filename: string) =>
  new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` },
  });
routes.get('/campuses/:id/assets.csv', async (c) =>
  csvResponse(await exportAssetsCsv(c.get('db'), idParam(c)), 'assets.csv'),
);
routes.get('/campuses/:id/rooms.csv', async (c) => csvResponse(await exportRoomsCsv(c.get('db'), idParam(c)), 'rooms.csv'));
/** Body is the CSV itself (text/csv); the rooms export is the template. */
routes.post('/campuses/:id/rooms/import', async (c) => {
  await requireUser(c);
  const text = await c.req.text();
  if (!text.trim()) throw new HttpError(400, 'send the CSV as the request body');
  return c.json(await importRoomsCsv(c.get('db'), idParam(c), text));
});

routes.get('/asset-types', async (c) =>
  c.json(await c.get('db').select().from(s.assetType).orderBy(s.assetType.category, s.assetType.name)),
);

routes.get('/buildings/:id/systems', async (c) => {
  const db = c.get('db');
  return c.json(await withPhotos(db, c.get('storage'), await listBuildingSystems(db, idParam(c))));
});

routes.get('/rooms/:id', async (c) => {
  const db = c.get('db');
  const room = await getRoom(db, idParam(c));
  const storage = c.get('storage');
  return c.json({
    ...room,
    photos: await photosByRoom(db, storage, room.id),
    assets: await withPhotos(db, storage, room.assets),
  });
});
routes.post('/rooms/:id/walked', async (c) =>
  c.json(await setRoomWalked(c.get('db'), idParam(c), await requireUser(c))),
);
routes.delete('/rooms/:id/walked', async (c) => {
  await requireUser(c);
  return c.json(await setRoomWalked(c.get('db'), idParam(c), null));
});

routes.get('/assets/:id', async (c) => {
  const db = c.get('db');
  const id = idParam(c);
  const asset = await getAsset(db, id);
  if (!asset) throw notFound('asset');
  const [withPhotoList] = await withPhotos(db, c.get('storage'), [asset]);
  return c.json({ ...withPhotoList, events: await listAssetEvents(db, id) });
});
routes.post('/assets', async (c) => {
  const actorId = await requireUser(c);
  const input = await parseBody(c, CreateAssetInput);
  return c.json(await createAsset(c.get('db'), input, actorId), 201);
});
routes.patch('/assets/:id', async (c) => {
  const actorId = await requireUser(c);
  const input = await parseBody(c, UpdateAssetInput);
  return c.json(await updateAsset(c.get('db'), idParam(c), input, actorId));
});
routes.post('/assets/:id/move', async (c) => {
  const actorId = await requireUser(c);
  const input = await parseBody(c, MoveAssetInput);
  return c.json(await moveAsset(c.get('db'), idParam(c), input, actorId));
});
routes.post('/assets/:id/copy', async (c) => {
  const actorId = await requireUser(c);
  const input = await parseBody(c, CopyAssetInput);
  return c.json(await copyAsset(c.get('db'), idParam(c), input, actorId), 201);
});
routes.delete('/assets/:id', async (c) => {
  const actorId = await requireUser(c);
  const { version } = await parseBody(c, DeleteAssetInput);
  await deleteAsset(c.get('db'), idParam(c), version, actorId);
  return c.body(null, 204);
});

/**
 * Photo flow: POST /uploads hands the phone a presigned PUT, the phone uploads straight to
 * object storage, then POST /photos records the object and runs the AI suggestion over it.
 */
routes.post('/uploads', async (c) => {
  await requireUser(c);
  const { contentType } = await parseBody(c, CreateUploadInput);
  return c.json(await createUpload(c.get('storage'), contentType), 201);
});
routes.post('/photos', async (c) => {
  await requireUser(c);
  const input = await parseBody(c, CreatePhotoInput);
  return c.json(await createPhoto(c.get('db'), c.get('storage'), c.get('suggester'), input), 201);
});
/** One photo with what it is attached to, for the photo screen. */
routes.get('/photos/:id', async (c) => {
  const db = c.get('db');
  const photo = await getPhoto(db, c.get('storage'), idParam(c));
  if (!photo) throw notFound('photo');
  return c.json({
    ...photo,
    asset: photo.assetId ? await getAsset(db, photo.assetId) : null,
    room: photo.roomId ? await roomHeader(db, photo.roomId) : null,
  });
});
routes.delete('/photos/:id', async (c) => {
  await requireUser(c);
  await deletePhoto(c.get('db'), c.get('storage'), idParam(c));
  return c.body(null, 204);
});
