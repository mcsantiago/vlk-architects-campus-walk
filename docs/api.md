# Campus Walk — API Contract

Base URL locally: `http://localhost:3000` directly, or `/api` on the web app's origin (the Vite dev server proxies it, which is how a phone on the LAN reaches it). All bodies and responses are JSON unless noted. Status as of 2026-10-12; every endpoint below (24) is implemented and covered by `apps/api/test/*.test.ts`.

## Conventions

**Identity.** There is no login. The client calls `POST /users` once and sends the returned id on every write:

```
x-user-id: <uuid>
```

Reads never need it. Writes without it, or with an id that is not a known user, get `401`. The id becomes `changedBy` on asset events and `walkedBy` on rooms.

**Ids.** All ids are UUIDs. A malformed id in a path is treated as "not found" (`404`), never a `500`.

**Validation.** Request bodies are validated with the zod schemas in `packages/shared/src/api.ts`. The web app imports the same schemas.

**Timestamps** are ISO 8601 strings in UTC. **Condition** is an integer 1–5: 5 Excellent, 4 Good, 3 Fair, 2 Poor, 1 Critical. "Poor condition" means `condition <= 2`.

**Errors** always have the same envelope:

```json
{ "error": "<human-readable message>", "details": <see below> }
```

| Status | When | `details` |
|---|---|---|
| 400 | zod validation failed | `[{ "path": "condition", "message": "..." }, ...]` |
| 400 | a business rule or DB constraint was violated | `null`, or `{ "constraint": "<name>" }` when the database caught it |
| 400 | CSV import has row errors | `[{ "line": 3, "message": "room_type: ..." }, ...]` |
| 401 | missing or unknown `x-user-id` on a write | `null` |
| 404 | resource missing, malformed id, or unknown route | `null` |
| 409 | asset `version` in the body is stale | `{ "current": <Asset> }` — the record as it is now |
| 500 | bug | `null` |

## Shared shapes

### `User`
```json
{ "id": "uuid", "name": "Dana R.", "createdAt": "2026-10-09T..." }
```

### `AssetType`
```json
{ "id": "uuid", "name": "Projector", "category": "furniture | equipment | system", "trackedIndividually": true }
```
`trackedIndividually` means one record per unit (`quantity` must be 1). Furniture is counted via `quantity`.

### `Asset`
```json
{
  "id": "uuid",
  "buildingId": "uuid",
  "floorId": "uuid | null",
  "roomId": "uuid | null",
  "label": "RTU-2 | null",
  "quantity": 1,
  "condition": 2,
  "notes": "string | null",
  "version": 3,
  "createdAt": "...",
  "updatedAt": "...",
  "assetType": { "id": "uuid", "name": "Rooftop HVAC Unit", "category": "system", "trackedIndividually": true }
}
```
Location: `buildingId` is always set. `floorId` null = building-level asset (rooftop unit). `roomId` null with `floorId` set = floor-level asset (corridor panel). Soft-deleted assets never appear anywhere.

### `Campus`
```json
{
  "id": "uuid", "name": "Live Oak K-8", "district": "Cedar Valley ISD",
  "address": "string | null", "contactName": "string | null", "contactPhone": "string | null", "contactEmail": "string | null",
  "createdAt": "..."
}
```
Buildings carry the same four address/contact fields (all nullable) next to `name`, `code` and `yearBuilt`.

### `Photo`
```json
{
  "id": "uuid",
  "assetId": "uuid | null",
  "roomId": "uuid | null",
  "url": "https://... presigned GET, valid 15 minutes",
  "suggestion": <AiSuggestion> | null,
  "createdAt": "..."
}
```

### `AiSuggestion`
```json
{
  "assetTypeId": "uuid | null",
  "assetTypeName": "Projector | null",
  "condition": 3,
  "note": "Ceiling-mounted projector, lens housing cracked.",
  "confidence": "low | medium | high",
  "model": "anthropic.claude-opus-5-5"
}
```
A photo is of one asset (`assetId`), of the room itself (`roomId`), or not yet attached (both null, taken before the asset was saved). Never both. `null` for the whole suggestion means the model was off, refused, timed out or said nothing useful. The form then opens empty.

### `Location` (request fragment)
```json
{ "buildingId": "uuid?", "floorId": "uuid?", "roomId": "uuid?" }
```
Send any one; the server fills in the levels above it (`roomId` → `floorId` → `buildingId`). If you send more than one and they disagree ("room is not on the given floor", "floor is not in the given building") you get a `400`. At least one is required.

---

## Users

### `GET /users`
List all users, sorted by name. **Auth:** none.
**200** → `User[]`

### `POST /users`
Find or create by name. Matching is case-insensitive and trims whitespace, so `"dana r."` returns the existing `"Dana R."`. **Auth:** none.
```json
{ "name": "string, 1–60 chars" }
```
**201** → `User` (the existing record if matched)
**400** empty name.

---

## Browse

### `GET /campuses`
**Auth:** none.
**200** → `Campus[]`

### `GET /campuses/:id/tree`
Everything the field app needs to navigate: buildings → floors → rooms with walk status and counts. **Auth:** none.
**200** →
```json
{
  ...Campus,
  "progress": { "rooms": 36, "walked": 16 },
  "buildings": [{
    "id": "uuid", "campusId": "uuid", "name": "Main Classroom Building", "code": "A", "yearBuilt": 1998,
    "address": "... | null", "contactName": "... | null", "contactPhone": "... | null", "contactEmail": "... | null", "createdAt": "...",
    "systemAssetCount": 11,
    "floors": [{
      "id": "uuid", "buildingId": "uuid", "name": "Floor 1", "level": 1, "createdAt": "...",
      "rooms": [{
        "id": "uuid", "floorId": "uuid", "number": "101", "name": "Kindergarten A", "roomType": "classroom",
        "walkedAt": "... | null", "walkedById": "uuid | null", "createdAt": "...",
        "assetCount": 6,
        "walkedBy": { "id": "uuid", "name": "Dana R." } | null
      }]
    }]
  }]
}
```
`systemAssetCount` = building- and floor-level assets (no room). Buildings sort by code, floors by level, rooms by number.
**404** unknown campus.

### `GET /rooms/:id`
Room with ancestry, photos of the room itself, and its assets (each with its own photos). **Auth:** none.
**200** →
```json
{
  "id": "uuid", "floorId": "uuid", "number": "101", "name": "...", "roomType": "classroom",
  "walkedAt": "... | null", "walkedById": "uuid | null", "createdAt": "...",
  "walkedBy": { "id": "uuid", "name": "..." } | null,
  "floor": { "id": "uuid", "name": "Floor 1", "level": 1 },
  "building": { "id": "uuid", "name": "...", "code": "A" },
  "photos": [ Photo ],
  "assets": [ Asset & { "photos": Photo[] } ]
}
```
`photos` are context shots of the room (`roomId` set); asset photos ride on each asset. Assets sort by category, type name, label, created time.
**404** unknown room.

### `GET /buildings/:id/systems`
Building- and floor-level assets: everything in the building with no room. **Auth:** none.
**200** → `(Asset & { photos: Photo[] })[]`
**404** unknown building.

### `GET /asset-types`
**Auth:** none.
**200** → `AssetType[]` sorted by category then name.

### `POST /asset-types`
Add a type to the catalogue from the field, or find it by name (case-insensitive, trimmed). An existing name keeps its stored category and tracking; the body's values are only used when creating. **Auth:** required.
```json
{ "name": "Kiln", "category": "equipment", "trackedIndividually": true }
```
`category` is one of `furniture`, `equipment`, `system`. `trackedIndividually: true` means one record per unit; `false` means the type is counted with a quantity.
**201** → `AssetType` (new or existing).
**400** validation, **401**.

---

## Walk status

### `POST /rooms/:id/walked`
Mark the room walked by the calling user, now. Idempotent; a second call updates the time and walker. A room with zero assets can be walked. **Auth:** required.
No body.
**200** → room header (the `GET /rooms/:id` shape without `assets`), with `walkedAt` and `walkedBy` set.
**401**, **404**.

### `DELETE /rooms/:id/walked`
Clear the walked mark. **Auth:** required.
**200** → room header with `walkedAt: null`, `walkedBy: null`.

---

## Assets

### `GET /assets/:id`
Asset with photos and full history. **Auth:** none.
**200** →
```json
Asset & {
  "photos": Photo[],
  "events": [{
    "id": "uuid",
    "kind": "created | updated | moved | deleted",
    "before": <snapshot | null>,
    "after": <snapshot | null>,
    "changedAt": "...",
    "changedBy": { "id": "uuid", "name": "..." }
  }]
}
```
`created`: `before` null, `after` = full Asset. `updated`: both full Assets. `moved`: both `{ buildingId, floorId, roomId }`. `deleted`: `after` null. Events sort oldest first.
**404** unknown or soft-deleted.

### `POST /assets`
**Auth:** required.
```json
{
  "roomId" | "floorId" | "buildingId": "uuid",      // Location, see above
  "assetTypeId": "uuid",
  "quantity": 1,                                   // int 1–10000, default 1; must be 1 if type is trackedIndividually
  "condition": 4,                                  // int 1–5, required
  "label": "string ≤ 80 | null",                   // optional
  "notes": "string ≤ 2000 | null",                 // optional
  "photoIds": ["uuid"]                             // optional, ≤ 10; photos must exist and be unattached
}
```
**201** → `Asset` (version 1). Writes a `created` event. Photos in `photoIds` get `assetId` set in the same transaction.
**400** validation; `"<type> is tracked individually; add one record per unit"`; location mismatch; `"a photo was not found or is already attached to an asset"`.
**404** `"room not found"`, `"floor not found"`, `"building not found"`, `"asset type not found"`.

### `PATCH /assets/:id`
Partial update with optimistic concurrency. **Auth:** required.
```json
{
  "version": 3,                 // required: the version you last read
  "assetTypeId": "uuid",        // optional
  "quantity": 24,               // optional
  "condition": 2,               // optional
  "label": "string | null",     // optional; null clears
  "notes": "string | null"      // optional; null clears
}
```
The quantity rule is re-checked against the resulting type and quantity (changing a counted type to an individually tracked one with quantity 24 fails).
**200** → `Asset` with `version + 1`. Writes an `updated` event.
**409** stale version; `details.current` is the live record.
**400**, **401**, **404**.

### `POST /assets/:id/move`
**Auth:** required.
```json
{ "version": 3, "roomId" | "floorId" | "buildingId": "uuid" }
```
Moving to `buildingId` alone makes it a building-level asset; to `floorId` alone, floor-level. Cross-building moves are allowed.
**200** → `Asset` with the new location and `version + 1`. Writes a `moved` event with before/after location.
**409**, **400**, **401**, **404**.

### `POST /assets/:id/copy`
Copy an asset to another room, floor or building level. The copy gets the source's type, quantity, condition, label and notes as a new record with `version` 1 and its own `created` event. Photos stay with the original: they are of that unit, not the copy. **Auth:** required.
```json
{ "roomId" | "floorId" | "buildingId": "uuid" }     // Location, see above
```
**201** → the new `Asset`.
**400** location mismatch or missing. **404** unknown source asset or location.

### `DELETE /assets/:id`
Soft delete. The row and its history stay for audit; it leaves every listing and rollup. **Auth:** required.
```json
{ "version": 3 }
```
**204** no body. Writes a `deleted` event.
**409** stale version. **404** if already deleted.

---

## Photos

Flow: `POST /uploads` → PUT the bytes to the returned URL (from the phone, directly to storage) → `POST /photos` with the key → either pass the photo id in `POST /assets { photoIds }` or `POST /photos` with `assetId` for an existing asset.

### `POST /uploads`
**Auth:** required.
```json
{ "contentType": "image/jpeg | image/png | image/webp" }
```
**201** →
```json
{ "key": "photos/<uuid>.jpg", "url": "https://... presigned PUT", "expiresInSeconds": 900 }
```
PUT the file to `url` with the same `Content-Type` header. The API mints the key; clients cannot choose it.
**400** other content types.

### `POST /photos`
Record an uploaded object and run the AI suggestion over it. **Auth:** required.
```json
{ "s3Key": "photos/<uuid>.jpg", "assetId": "uuid | null", "roomId": "uuid | null" }   // at most one of assetId / roomId
```
Omit both for a photo taken before the asset exists (attach it via `POST /assets { photoIds }`); send `roomId` for a photo of the room itself.
**201** → `Photo` (with `suggestion`, which may be null: model off, unsure, slow or failing; the photo is saved regardless).
**400** `"unknown upload key"` (not a key this API minted); `"upload not found; PUT the file to the upload URL first"`; `"photo already recorded for this upload"`; `"upload is not a JPEG, PNG or WebP image"` (by its bytes); `"upload is image/png but was sent as image/jpeg"`; `"image is larger than 10 MB"`; both `assetId` and `roomId` given.
**404** `assetId` or `roomId` unknown.

### `GET /photos/:id`
One photo with whatever it is attached to, for the photo screen. **Auth:** none.
**200** → `Photo & { "asset": Asset | null, "room": <room header, the GET /rooms/:id shape without photos/assets> | null }`
**404**.

Suggestion runs only when `BEDROCK_MODEL` is configured on the server. Images over 4.5 MB skip it. Expect 2–6 s of latency when it runs.

### `DELETE /photos/:id`
Deletes the record and best-effort deletes the object. **Auth:** required.
**204**. **404**.

---

## Office

### `GET /campuses/:id/summary?buildingId=<uuid>`
The roll-up. `buildingId` is optional and scopes everything to one building. **Auth:** none.
**200** →
```json
{
  "campus": { "id": "uuid", "name": "...", "district": "...", "createdAt": "..." },
  "buildingId": "uuid | null",
  "rooms": {
    "total": 36,
    "walked": 16,
    "notWalked": [{
      "id": "uuid", "number": "105", "name": "...", "roomType": "classroom", "assetCount": 0,
      "floor": { "id": "uuid", "name": "Floor 1", "level": 1 },
      "building": { "id": "uuid", "code": "A", "name": "..." }
    }]
  },
  "walkers": [{ "user": { "id": "uuid", "name": "Dana R." }, "roomsWalked": 9 }],
  "countsByType": [{ "assetTypeId": "uuid", "name": "Student Chair", "category": "furniture", "records": 9, "units": 204 }],
  "poorCondition": [ Asset & {
    "building": { "id": "uuid", "code": "A", "name": "..." },
    "floor": { "id": "uuid", "name": "..." } | null,
    "room": { "id": "uuid", "number": "...", "name": "..." } | null
  }],
  "poorConditionMax": 2
}
```
`records` = number of asset rows, `units` = `SUM(quantity)`. `countsByType` sorts by units desc. `notWalked` sorts by building code, floor level, room number. `poorCondition` is `condition <= poorConditionMax`, sorted worst first.
**404** unknown campus.

---

## CSV

### `GET /campuses/:id/assets.csv`
**Auth:** none. **200** `text/csv`, `Content-Disposition: attachment; filename="assets.csv"`, CRLF line ends. One row per live asset:

```
building_code,building_name,floor_level,floor_name,room_number,room_name,asset_type,category,label,quantity,condition,condition_label,notes,updated_at,asset_id
```
Floor and room columns are empty for building- and floor-level assets.

### `GET /campuses/:id/rooms.csv`
**Auth:** none. **200** `text/csv`. Every room, in the import format plus `walked_at`, so it doubles as the import template:

```
building_code,building_name,floor_level,floor_name,room_number,room_name,room_type,walked_at
```

### `POST /campuses/:id/rooms/import`
Body is the CSV text itself (`Content-Type: text/csv`). **Auth:** required.

Required columns (header names are case-insensitive, extra columns ignored, BOM tolerated):

| Column | Rule |
|---|---|
| `building_code` | 1–10 chars; matched against existing buildings on the campus |
| `building_name` | used only when creating the building; blank → `Building <code>` |
| `floor_level` | integer −10…200; matched per building |
| `floor_name` | used only when creating the floor; blank → `Floor <level>` |
| `room_number` | 1–20 chars; matched per floor |
| `room_name` | blank → the room number |
| `room_type` | one of `classroom lab library office gym cafeteria kitchen restroom storage mechanical corridor other` |

Semantics: buildings and floors are created when missing. A room that exists (same building code, floor level, room number) has its `name` and `room_type` updated, and keeps its walk status and assets. Nothing is ever deleted. The whole file is validated first and written in one transaction: any error means nothing is written. Max 5,000 rows.

**200** →
```json
{ "rows": 5, "buildings": { "created": 1 }, "floors": { "created": 2 }, "rooms": { "created": 4, "updated": 1 } }
```
**400** `"could not read CSV: missing columns: ..."`, `"no rows to import"`, `"too many rows (max 5000)"`, or `"import has errors; nothing was written"` with `details: [{ line, message }]` (line numbers are physical lines in the file, header is line 1; duplicates within the file are reported too).
**401**, **404**.

---

## Misc

### `GET /health`
**200** → `{ "ok": true }`

### Anything else
**404** → `{ "error": "not found", "details": null }`

## Not yet implemented (scope doc)
Nothing in the API sketch remains. Possible additions once the web app exists: `PATCH /photos/:id` to re-attach, `GET /openapi.json` via `@hono/zod-openapi`.
