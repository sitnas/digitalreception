import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { AppConfig } from './app-config';

/**
 * Where encrypted blobs live. Content is always encrypted by the application BEFORE it
 * reaches the driver, so neither the disk nor the object store ever sees plaintext.
 *  - local: single node, or several nodes sharing a network volume;
 *  - s3:    any S3-compatible store (MinIO on-prem, or a cloud bucket) for horizontal scaling.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');

class LocalStorage implements StorageDriver {
  private readonly root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  private abs(key: string) {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + '/')) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, data: Buffer) {
    const p = this.abs(key);
    await fs.mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await fs.writeFile(p, data, { mode: 0o600 });
  }
  get(key: string) { return fs.readFile(this.abs(key)); }
  async delete(key: string) {
    const p = this.abs(key);
    try {
      const st = await fs.stat(p);
      await fs.writeFile(p, Buffer.alloc(st.size)); // best-effort overwrite before unlink
      await fs.unlink(p);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}

class S3Storage implements StorageDriver {
  private readonly s3: S3Client;
  constructor(private readonly c: Extract<AppConfig['storage'], { driver: 's3' }>) {
    this.s3 = new S3Client({
      region: c.region, endpoint: c.endpoint, forcePathStyle: c.forcePathStyle,
      credentials: c.accessKeyId && c.secretAccessKey ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
    });
  }
  private k(key: string) { return `${this.c.prefix}${key}`; }
  async put(key: string, data: Buffer) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.c.bucket, Key: this.k(key), Body: data, ContentType: 'application/octet-stream' }));
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.c.bucket, Key: this.k(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.c.bucket, Key: this.k(key) }));
  }
}

export function createStorage(cfg: AppConfig): StorageDriver {
  return cfg.storage.driver === 's3' ? new S3Storage(cfg.storage) : new LocalStorage(cfg.storage.dir);
}
