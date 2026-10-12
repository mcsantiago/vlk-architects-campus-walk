import type { PhotoView, UploadTicket } from '@campus-walk/shared';
import { api, ApiError } from './client';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Phones produce 3–12 MB photos; the model only needs a few hundred KB. Resize on the device
 * before upload so the PUT is fast on site Wi-Fi and the suggestion never hits the size cap.
 * createImageBitmap applies the EXIF orientation so the saved photo is upright.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('could not read that image');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('could not encode the image');
  return blob;
}

export type UploadStage = 'resizing' | 'uploading' | 'analyzing';

/**
 * The three-step photo flow: ask the API for a presigned PUT, send the bytes straight to object
 * storage, then record the photo (which runs the AI suggestion). The subject is an existing asset,
 * the room itself, or null when the asset is still being created (attach via photoIds on save).
 */
export type PhotoSubject = { assetId: string } | { roomId: string } | null;

export async function uploadPhoto(
  file: File,
  subject: PhotoSubject,
  onStage: (stage: UploadStage) => void = () => {},
): Promise<PhotoView> {
  onStage('resizing');
  const blob = await shrinkImage(file);

  onStage('uploading');
  const ticket = await api<UploadTicket>('/uploads', { method: 'POST', body: { contentType: 'image/jpeg' } });
  const put = await fetch(ticket.url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob });
  if (!put.ok) throw new ApiError(put.status, `upload failed (${put.status})`);

  onStage('analyzing');
  return api<PhotoView>('/photos', { method: 'POST', body: { s3Key: ticket.key, ...subject } });
}
