import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FileKind, StoredFile } from '../entities';
import { TenantCrypto } from './crypto.service';
import { STORAGE, StorageDriver } from './storage';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Encrypted image storage. Files are only readable through authenticated, audited API calls. */
@Injectable()
export class FilesService {
  constructor(@Inject(STORAGE) private readonly storage: StorageDriver, @InjectRepository(StoredFile) private readonly repo: Repository<StoredFile>) {}

  /** Validates a data URL and returns the decoded image. JPEG and PNG only, magic bytes checked. */
  parseImage(dataUrl: string, field: string): { mime: string; data: Buffer } {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
    if (!m) throw new BadRequestException(`${field}: expected a JPEG or PNG image`);
    const data = Buffer.from(m[2], 'base64');
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new BadRequestException(`${field}: image too large`);
    const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if ((m[1] === 'image/jpeg' && !isJpeg) || (m[1] === 'image/png' && !isPng)) throw new BadRequestException(`${field}: content does not match type`);
    return { mime: m[1], data };
  }

  async store(em: EntityManager, tc: TenantCrypto, visitId: string, kind: FileKind, image: { mime: string; data: Buffer }, purgeAfter: Date): Promise<StoredFile> {
    const saved = await em.save(em.create(StoredFile, { tenantId: tc.tenantId, visitId, kind, mime: image.mime, size: image.data.length, purgeAfter, purgedAt: null, keyId: '', storagePath: '' }));
    const now = new Date();
    const key = `${tc.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${saved.id}.bin`;
    const { keyId, blob } = tc.encryptBuffer(image.data, `file:${saved.id}`);
    await this.storage.put(key, blob);
    saved.keyId = keyId;
    saved.storagePath = key;
    return em.save(saved);
  }

  async read(tc: TenantCrypto, file: StoredFile): Promise<Buffer> {
    if (file.purgedAt) throw new BadRequestException('FILE_EXPIRED');
    if (file.tenantId !== tc.tenantId) throw new Error('Tenant mismatch');
    return tc.decryptBuffer(file.keyId, await this.storage.get(file.storagePath), `file:${file.id}`);
  }

  async purge(file: StoredFile): Promise<void> {
    if (!file.purgedAt && file.storagePath) await this.storage.delete(file.storagePath);
    await this.repo.update(file.id, { purgedAt: new Date() });
  }
}
