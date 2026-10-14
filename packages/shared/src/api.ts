import { z } from 'zod';

/** Request schemas shared by the API (validation) and the web app (form types). */

const uuid = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Identity is a chosen user, not a login: the client sends the user's id in this header on
 * every write, and it is recorded as changed_by on asset events and as the room's walker.
 */
export const USER_HEADER = 'x-user-id';

export const CreateUserInput = z.object({ name: z.string().trim().min(1).max(60) });
export type CreateUserInput = z.infer<typeof CreateUserInput>;

/** A category key; whether it exists is the database's call (asset_category), not a list in code. */
const categoryKey = z.string().trim().min(1).max(40);

/** A walker can add a type from the field; names are matched case-insensitively so "kiln" finds "Kiln". */
export const CreateAssetTypeInput = z.object({
  name: z.string().trim().min(1).max(60),
  category: categoryKey,
  trackedIndividually: z.boolean(),
});
export type CreateAssetTypeInput = z.infer<typeof CreateAssetTypeInput>;

/** Recategorise a type (every asset of that type follows) or change how it is counted. The name stays. */
export const UpdateAssetTypeInput = z
  .object({
    category: categoryKey.optional(),
    trackedIndividually: z.boolean().optional(),
  })
  .refine((u) => u.category !== undefined || u.trackedIndividually !== undefined, { message: 'nothing to change' });
export type UpdateAssetTypeInput = z.infer<typeof UpdateAssetTypeInput>;

/**
 * Where an asset lives. Any subset may be sent; the server resolves the rest
 * (roomId -> floorId -> buildingId) and rejects combinations that disagree.
 */
export const LocationInput = z
  .object({
    buildingId: uuid.optional(),
    floorId: uuid.nullable().optional(),
    roomId: uuid.nullable().optional(),
  })
  .refine((l) => l.buildingId || l.floorId || l.roomId, {
    message: 'one of buildingId, floorId or roomId is required',
  });
export type LocationInput = z.infer<typeof LocationInput>;

/** Make, model, serial and install year: carried over from a district's inventory, shown read-only in the field. */
const provenanceFields = {
  manufacturer: optionalText(80),
  model: optionalText(80),
  serialNumber: optionalText(80),
  installYear: z.int().min(1800).max(2200).nullable().optional(),
};

const assetFields = {
  assetTypeId: uuid,
  label: optionalText(80),
  quantity: z.int().min(1).max(10_000).default(1),
  /** Null means not yet rated: an imported record the walk has not reached. The field form always sends one. */
  condition: z.int().min(1).max(5).nullable().default(null),
  notes: optionalText(2_000),
  ...provenanceFields,
};

export const CreateAssetInput = LocationInput.safeExtend({
  ...assetFields,
  /** Photos taken before the asset existed (POST /photos without assetId); attached on create. */
  photoIds: z.array(uuid).max(10).default([]),
});
export type CreateAssetInput = z.infer<typeof CreateAssetInput>;

const version = z.int().min(1);

export const UpdateAssetInput = z.object({
  version,
  assetTypeId: assetFields.assetTypeId.optional(),
  label: assetFields.label,
  quantity: z.int().min(1).max(10_000).optional(),
  condition: z.int().min(1).max(5).nullable().optional(),
  notes: assetFields.notes,
  ...provenanceFields,
});
export type UpdateAssetInput = z.infer<typeof UpdateAssetInput>;

export const MoveAssetInput = LocationInput.safeExtend({ version });
export type MoveAssetInput = z.infer<typeof MoveAssetInput>;

export const DeleteAssetInput = z.object({ version });
export type DeleteAssetInput = z.infer<typeof DeleteAssetInput>;

/** Copy an asset (type, quantity, condition, label, notes; not its photos) to another location. */
export const CopyAssetInput = LocationInput;
export type CopyAssetInput = z.infer<typeof CopyAssetInput>;

/** Photo uploads go straight from the phone to object storage via a presigned PUT. */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const CreateUploadInput = z.object({ contentType: z.enum(IMAGE_CONTENT_TYPES) });
export type CreateUploadInput = z.infer<typeof CreateUploadInput>;

/** Records an uploaded object as a photo and runs the AI suggestion over it. */
export const CreatePhotoInput = z
  .object({
    s3Key: z.string().min(1).max(200),
    /** Omit when the photo is taken before the asset exists; pass photoIds to POST /assets instead. */
    assetId: uuid.nullable().optional(),
    /** A photo of the room itself rather than of one asset. */
    roomId: uuid.nullable().optional(),
  })
  .refine((p) => !(p.assetId && p.roomId), { message: 'a photo belongs to an asset or a room, not both' });
export type CreatePhotoInput = z.infer<typeof CreatePhotoInput>;

export const SUGGESTION_CONFIDENCES = ['low', 'medium', 'high'] as const;

/**
 * What the model proposed for a photo, stored on the photo for audit. The asset type is resolved
 * to a known id when the model's answer matches one; null fields mean "no opinion".
 */
export const AiSuggestion = z.object({
  assetTypeId: uuid.nullable(),
  assetTypeName: z.string().nullable(),
  condition: z.int().min(1).max(5).nullable(),
  note: z.string(),
  confidence: z.enum(SUGGESTION_CONFIDENCES),
  model: z.string(),
});
export type AiSuggestion = z.infer<typeof AiSuggestion>;

/**
 * CSV import of rooms: the realistic stand-in for "upload a floor plan". Buildings and floors
 * are created as needed; existing rooms (same building code, floor level and room number)
 * have their name and type updated. Nothing is deleted.
 */
export const ROOM_CSV_COLUMNS = [
  'building_code',
  'building_name',
  'floor_level',
  'floor_name',
  'room_number',
  'room_name',
  'room_type',
] as const;

export const RoomImportRow = z.object({
  building_code: z.string().trim().min(1).max(10),
  building_name: z.string().trim().max(120),
  floor_level: z.coerce.number().int().min(-10).max(200),
  floor_name: z.string().trim().max(60),
  room_number: z.string().trim().min(1).max(20),
  room_name: z.string().trim().max(120),
  room_type: z.string().trim().min(1).max(40),
});
export type RoomImportRow = z.infer<typeof RoomImportRow>;
