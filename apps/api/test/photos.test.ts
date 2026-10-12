import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiSuggestion } from '@campus-walk/shared';
import { createApp, type App } from '../src/app.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedCampus } from '../src/db/seed.ts';
import { CAMPUS } from '../src/db/seed-data.ts';
import { MemoryPhotoStorage } from '../src/storage.ts';
import { normalizeSuggestion, type Suggester, type SuggestionInput } from '../src/suggest.ts';
import { freshDb } from './helpers.ts';

const TYPES = [
  { id: randomUUID(), name: 'Projector', category: 'equipment' },
  { id: randomUUID(), name: 'Student Desk', category: 'furniture' },
];

describe('normalizeSuggestion', () => {
  it('resolves the type by name, case-insensitively', () => {
    const out = normalizeSuggestion(
      { asset_type: 'projector', condition: 3, confidence: 'high', note: ' Ceiling mount, lens scratched. ' },
      TYPES,
      'm',
    );
    expect(out).toEqual({
      assetTypeId: TYPES[0]!.id,
      assetTypeName: 'Projector',
      condition: 3,
      note: 'Ceiling mount, lens scratched.',
      confidence: 'high',
      model: 'm',
    });
  });

  it('keeps a condition when the type is unknown, and vice versa', () => {
    expect(normalizeSuggestion({ asset_type: 'Kiln', condition: 2, confidence: 'low', note: '' }, TYPES, 'm')).toMatchObject({
      assetTypeId: null,
      assetTypeName: null,
      condition: 2,
    });
    expect(normalizeSuggestion({ asset_type: 'Student Desk', condition: null, confidence: 'medium', note: 'n' }, TYPES, 'm')).toMatchObject({
      assetTypeName: 'Student Desk',
      condition: null,
    });
  });

  it('degrades malformed or empty output to null', () => {
    const cases: unknown[] = [
      null,
      'Projector, condition 3',
      { asset_type: 'Projector' },
      { asset_type: 'Projector', condition: 9, confidence: 'high', note: '' },
      { asset_type: 'Projector', condition: 3, confidence: 'sure', note: '' },
      { asset_type: null, condition: null, confidence: 'low', note: 'blurry' },
    ];
    for (const raw of cases) expect(normalizeSuggestion(raw, TYPES, 'm'), JSON.stringify(raw)).toBeNull();
  });
});

describe('photo flow', () => {
  let h: DbHandle;
  let app: App;
  let userId: string;
  let roomId: string;
  let projectorTypeId: string;
  const storage = new MemoryPhotoStorage();
  const calls: SuggestionInput[] = [];
  let canned: AiSuggestion | null = null;
  const suggester: Suggester = {
    async suggest(input) {
      calls.push(input);
      return canned;
    },
  };

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** Simulates the phone's PUT to the presigned URL. */
  async function upload(contentType = 'image/jpeg') {
    const { status, body } = await call('POST', '/uploads', { contentType });
    expect(status).toBe(201);
    expect(body.url).toBe(`memory://upload/${body.key}`);
    storage.put(body.key, new Uint8Array([0xff, 0xd8, 0xff]), contentType);
    return body.key as string;
  }

  beforeAll(async () => {
    h = await freshDb();
    const campusId = await seedCampus(h.db, CAMPUS);
    app = createApp({ db: h.db, storage, suggester });
    userId = (await call('POST', '/users', { name: 'Photo Tester' })).body.id;
    const tree = (await call('GET', `/campuses/${campusId}/tree`)).body;
    roomId = tree.buildings[0].floors[0].rooms.find((r: { number: string }) => r.number === '105').id;
    const types: { id: string; name: string }[] = (await call('GET', '/asset-types')).body;
    projectorTypeId = types.find((t) => t.name === 'Projector')!.id;
    canned = {
      assetTypeId: projectorTypeId,
      assetTypeName: 'Projector',
      condition: 2,
      note: 'Lens scratched',
      confidence: 'medium',
      model: 'test-model',
    };
  });
  afterAll(() => h.close());

  it('requires a user and a supported content type for uploads', async () => {
    const anon = await app.request('/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    });
    expect(anon.status).toBe(401);
    expect((await call('POST', '/uploads', { contentType: 'image/gif' })).status).toBe(400);
  });

  it('records a photo, runs the suggestion, and attaches it to a new asset', async () => {
    const key = await upload();
    const photo = await call('POST', '/photos', { s3Key: key });
    expect(photo.status).toBe(201);
    expect(photo.body).toMatchObject({ assetId: null, url: `memory://${key}`, suggestion: canned });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toBe('image/jpeg');
    expect(calls[0]!.assetTypes.map((t) => t.name)).toContain('Projector');

    // The walker accepts the suggestion; the photo is attached in the same create.
    const asset = await call('POST', '/assets', {
      roomId,
      assetTypeId: photo.body.suggestion.assetTypeId,
      condition: photo.body.suggestion.condition,
      notes: photo.body.suggestion.note,
      photoIds: [photo.body.id],
    });
    expect(asset.status).toBe(201);

    const detail = (await call('GET', `/assets/${asset.body.id}`)).body;
    expect(detail.photos).toEqual([expect.objectContaining({ id: photo.body.id, assetId: asset.body.id })]);
    const room = (await call('GET', `/rooms/${roomId}`)).body;
    expect(room.assets[0].photos).toHaveLength(1);

    // Already attached: a second asset cannot claim it.
    const again = await call('POST', '/assets', { roomId, assetTypeId: projectorTypeId, condition: 3, photoIds: [photo.body.id] });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already attached/);
    expect(room.assets).toHaveLength(1);
  });

  it('attaches a photo to an existing asset and deletes it', async () => {
    const asset = (await call('POST', '/assets', { roomId, assetTypeId: projectorTypeId, condition: 4 })).body;
    canned = null; // model had nothing to say
    const photo = await call('POST', '/photos', { s3Key: await upload('image/png'), assetId: asset.id });
    expect(photo.status).toBe(201);
    expect(photo.body).toMatchObject({ assetId: asset.id, suggestion: null });

    expect((await call('DELETE', `/photos/${photo.body.id}`)).status).toBe(204);
    expect((await call('DELETE', `/photos/${photo.body.id}`)).status).toBe(404);
    expect((await call('GET', `/assets/${asset.id}`)).body.photos).toEqual([]);
    expect(storage.objects.size).toBe(1); // the earlier photo's object remains
  });

  it('rejects keys it did not mint, missing uploads and duplicates', async () => {
    const forged = await call('POST', '/photos', { s3Key: 'seed/secret.jpg' });
    expect(forged.status).toBe(400);
    expect(forged.body.error).toMatch(/unknown upload key/);

    const notUploaded = await call('POST', '/photos', { s3Key: `photos/${randomUUID()}.jpg` });
    expect(notUploaded.status).toBe(400);
    expect(notUploaded.body.error).toMatch(/upload not found/);

    const key = await upload();
    expect((await call('POST', '/photos', { s3Key: key })).status).toBe(201);
    const dup = await call('POST', '/photos', { s3Key: key });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/already recorded/);

    expect((await call('POST', '/photos', { s3Key: await upload(), assetId: randomUUID() })).status).toBe(404);
  });
});
