import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities';
import { CryptoService, TenantCrypto } from './crypto.service';

const TTL_MS = 5 * 60_000;

/**
 * Envelope encryption: unwraps a tenant's keys with the master key on demand and keeps them
 * in memory for a few minutes only. The master key never encrypts personal data directly.
 */
@Injectable()
export class TenantKeysService {
  private readonly cache = new Map<string, { crypto: TenantCrypto; expires: number }>();

  constructor(private readonly crypto: CryptoService, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async forTenant(tenantId: string): Promise<TenantCrypto> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.crypto;
    const t = await this.tenants.createQueryBuilder('t').addSelect(['t.dataKeysWrapped', 't.blindIndexKeyWrapped']).where('t.id = :id', { id: tenantId }).getOne();
    if (!t) throw new Error('Tenant not found');
    const wrapped = JSON.parse(t.dataKeysWrapped) as Record<string, string>;
    const deks = new Map(Object.entries(wrapped).map(([kid, w]) => [kid, this.crypto.unwrapKey(w, t.id, `dek:${kid}`)]));
    const bik = this.crypto.unwrapKey(t.blindIndexKeyWrapped, t.id, 'bik');
    const tc = new TenantCrypto(t.id, t.dataKeyId, deks, bik);
    this.cache.set(tenantId, { crypto: tc, expires: Date.now() + TTL_MS });
    return tc;
  }

  /** Fresh keys for a new tenant, already wrapped. */
  generate(tenantId: string) {
    const dataKeyId = 'd1';
    return {
      dataKeyId,
      dataKeysWrapped: JSON.stringify({ [dataKeyId]: this.crypto.wrapKey(this.crypto.newKey(), tenantId, `dek:${dataKeyId}`) }),
      blindIndexKeyWrapped: this.crypto.wrapKey(this.crypto.newKey(), tenantId, 'bik'),
    };
  }

  evict(tenantId: string) { this.cache.delete(tenantId); }
}
