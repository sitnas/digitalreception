import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { APP_CONFIG, AppConfig } from './app-config';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function gcmEncrypt(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

/**
 * Personal-data encryption bound to ONE tenant. Obtain it from TenantKeysService.
 *  - AES-256-GCM, random IV per value, key id stored with every value;
 *  - associated data = "<tenantId>|<column>": a ciphertext cannot be moved to another column or another tenant;
 *  - blind index = HMAC with the tenant's own key: identical surnames in two tenants give different hashes.
 */
export class TenantCrypto {
  constructor(readonly tenantId: string, private readonly dekId: string, private readonly deks: Map<string, Buffer>, private readonly bik: Buffer) {}

  private aad(context: string) { return `${this.tenantId}|${context}`; }

  encrypt(plain: string | null | undefined, context: string): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const { iv, tag, ct } = gcmEncrypt(this.deks.get(this.dekId)!, Buffer.from(plain, 'utf8'), this.aad(context));
    return [this.dekId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
  }

  decrypt(value: string | null | undefined, context: string): string | null {
    if (!value) return null;
    const [kid, iv, tag, ct] = value.split('.');
    const key = this.deks.get(kid);
    if (!key) throw new Error('Unknown data key');
    return gcmDecrypt(key, Buffer.from(iv, 'base64'), Buffer.from(tag, 'base64'), Buffer.from(ct, 'base64'), this.aad(context)).toString('utf8');
  }

  /** Binary layout: iv(12) | tag(16) | ciphertext */
  encryptBuffer(data: Buffer, context: string): { keyId: string; blob: Buffer } {
    const { iv, tag, ct } = gcmEncrypt(this.deks.get(this.dekId)!, data, this.aad(context));
    return { keyId: this.dekId, blob: Buffer.concat([iv, tag, ct]) };
  }

  decryptBuffer(keyId: string, blob: Buffer, context: string): Buffer {
    const key = this.deks.get(keyId);
    if (!key) throw new Error('Unknown data key');
    return gcmDecrypt(key, blob.subarray(0, 12), blob.subarray(12, 28), blob.subarray(28), this.aad(context));
  }

  blindIndex(value: string | null | undefined, context: string): string | null {
    if (!value) return null;
    const normalised = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalised) return null;
    return createHmac('sha256', this.bik).update(`${context}|${normalised}`).digest('hex');
  }
}

/** Platform-level primitives: key wrapping (envelope encryption), hashing, random values, passwords. */
@Injectable()
export class CryptoService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Wraps a tenant key with the active master key. Output: "<kekId>.<iv>.<tag>.<ct>" */
  wrapKey(key: Buffer, tenantId: string, purpose: string): string {
    const kid = this.cfg.masterKeys.activeKeyId;
    const { iv, tag, ct } = gcmEncrypt(this.cfg.masterKeys.keys.get(kid)!, key, `wrap|${tenantId}|${purpose}`);
    return [kid, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
  }

  unwrapKey(wrapped: string, tenantId: string, purpose: string): Buffer {
    const [kid, iv, tag, ct] = wrapped.split('.');
    const kek = this.cfg.masterKeys.keys.get(kid);
    if (!kek) throw new Error(`Master key ${kid} not configured`);
    return gcmDecrypt(kek, Buffer.from(iv, 'base64'), Buffer.from(tag, 'base64'), Buffer.from(ct, 'base64'), `wrap|${tenantId}|${purpose}`);
  }

  /** True if the key was wrapped with an older master key and should be re-wrapped. */
  needsRewrap(wrapped: string): boolean {
    return wrapped.split('.')[0] !== this.cfg.masterKeys.activeKeyId;
  }

  newKey(): Buffer { return randomBytes(32); }

  sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

  randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }

  /** Human-friendly code without ambiguous characters (0/O, 1/I/L), unbiased. */
  randomCode(length: number): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const out: string[] = [];
    while (out.length < length) {
      for (const b of randomBytes(length * 2)) if (b < 248 && out.length < length) out.push(alphabet[b % alphabet.length]);
    }
    return out.join('');
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, 64, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    return timingSafeEqual(expected, actual);
  }
}
