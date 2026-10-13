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
  /**
   * A view of this storage whose presigned URLs the given client can reach. `host` is the
   * request's Host header. Matters only for local object storage, where "localhost:9000"
   * means nothing to a phone on the LAN; on AWS the URLs are public already.
   */
  forViewer(host: string | undefined): PhotoStorage;
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
  /**
   * The endpoint browsers should use in presigned URLs when it differs from `endpoint`
   * (e.g. the laptop's LAN address). When unset and `endpoint` is loopback, the request's
   * host is substituted automatically; see forViewer.
   */
  publicEndpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class S3PhotoStorage implements PhotoStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly opts: S3StorageOptions;
  /** Signing clients per public endpoint, so a presign never rebuilds one per request. */
  private readonly signers = new Map<string, S3Client>();

  constructor(opts: S3StorageOptions, private readonly signer?: S3Client) {
    this.opts = opts;
    this.client = S3PhotoStorage.makeClient(opts, opts.endpoint);
    this.bucket = opts.bucket;
  }

  private static makeClient(opts: S3StorageOptions, endpoint: string | undefined): S3Client {
    const config: S3ClientConfig = { region: opts.region ?? 'us-east-1' };
    if (endpoint) {
      config.endpoint = endpoint;
      config.forcePathStyle = true;
    }
    if (opts.accessKeyId && opts.secretAccessKey) {
      config.credentials = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey };
    }
    return new S3Client(config);
  }

  /** The endpoint to sign URLs against for a client that sent `host`, or undefined for the default. */
  publicEndpointFor(host: string | undefined): string | undefined {
    if (this.opts.publicEndpoint) return this.opts.publicEndpoint;
    if (!this.opts.endpoint || !host) return undefined;
    const local = new URL(this.opts.endpoint);
    if (!LOOPBACK.has(local.hostname)) return undefined;
    const viewer = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
    if (!viewer || LOOPBACK.has(viewer)) return undefined;
    local.hostname = viewer;
    return local.origin;
  }

  forViewer(host: string | undefined): PhotoStorage {
    const endpoint = this.publicEndpointFor(host);
    if (!endpoint || endpoint === this.opts.endpoint) return this;
    let signer = this.signers.get(endpoint);
    if (!signer) {
      signer = S3PhotoStorage.makeClient(this.opts, endpoint);
      this.signers.set(endpoint, signer);
    }
    return new S3PhotoStorage(this.opts, signer);
  }

  presignUpload(key: string, contentType: ImageContentType) {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.signer ?? this.client, cmd, { expiresIn: URL_TTL_SECONDS });
  }

  presignDownload(key: string) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.signer ?? this.client, cmd, { expiresIn: URL_TTL_SECONDS });
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
  forViewer() {
    return this;
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
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
}
