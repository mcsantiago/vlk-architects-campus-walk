import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ImageContentType } from '@campus-walk/shared';

/** How long a presigned URL stays valid. Uploads happen right away; downloads are re-signed on every read. */
export const URL_TTL_SECONDS = 15 * 60;

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Where photo bytes live. The API never proxies image bytes to the browser: it hands out
 * presigned URLs for the upload and for each read. It does read the bytes itself, once, to
 * send them to the model.
 */
export interface PhotoStorage {
  presignUpload(key: string, contentType: ImageContentType): Promise<string>;
  presignDownload(key: string): Promise<string>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const EXTENSION: Record<ImageContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Keys are minted by the API so a client can never point a photo record at an arbitrary object. */
export const newPhotoKey = (contentType: ImageContentType) => `photos/${randomUUID()}.${EXTENSION[contentType]}`;
export const PHOTO_KEY = /^photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  /** RustFS/MinIO locally; unset on AWS. Path-style addressing is forced when set. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class S3PhotoStorage implements PhotoStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3StorageOptions) {
    const config: S3ClientConfig = { region: opts.region ?? 'us-east-1' };
    if (opts.endpoint) {
      config.endpoint = opts.endpoint;
      config.forcePathStyle = true;
    }
    if (opts.accessKeyId && opts.secretAccessKey) {
      config.credentials = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey };
    }
    this.client = new S3Client(config);
    this.bucket = opts.bucket;
  }

  presignUpload(key: string, contentType: ImageContentType) {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.client, cmd, { expiresIn: URL_TTL_SECONDS });
  }

  presignDownload(key: string) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: URL_TTL_SECONDS });
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return null;
      return { bytes: await out.Body.transformToByteArray(), contentType: out.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** In-process stand-in for tests and for running without Docker; nothing survives a restart. */
export class MemoryPhotoStorage implements PhotoStorage {
  readonly objects = new Map<string, StoredObject>();

  put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async presignUpload(key: string) {
    return `memory://upload/${key}`;
  }
  async presignDownload(key: string) {
    return `memory://${key}`;
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export function storageFromEnv(env = process.env): PhotoStorage {
  if (!env.S3_BUCKET) {
    console.warn('S3_BUCKET not set: photos are kept in memory and lost on restart');
    return new MemoryPhotoStorage();
  }
  return new S3PhotoStorage({
    bucket: env.S3_BUCKET,
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
}
