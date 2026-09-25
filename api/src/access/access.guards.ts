import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CryptoService } from '../common/crypto.service';
import { AppRequest } from '../common/request-context';
import { ApiKey, DoorReader } from '../entities';
import type { ReaderContext } from './access.service';

interface AccessRequest extends AppRequest { apiKey?: { id: string; tenantId: string }; reader?: ReaderContext }

export const CurrentApiKey = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AccessRequest>().apiKey!);
export const CurrentReader = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AccessRequest>().reader!);

/** Integration API: "Authorization: Bearer drk_…", a key of the organisation resolved from the host. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly crypto: CryptoService, @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AccessRequest>();
    const m = /^Bearer (drk_[A-Za-z0-9_-]{30,})$/.exec(req.headers.authorization ?? '');
    if (!m || !req.tenant) throw new UnauthorizedException('API_KEY_REQUIRED');
    const key = await this.keys.findOne({ where: { keyHash: this.crypto.sha256(m[1]), tenantId: req.tenant.id, revokedAt: IsNull() } });
    if (!key) throw new UnauthorizedException('API_KEY_INVALID');
    req.apiKey = { id: key.id, tenantId: key.tenantId };
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60_000) await this.keys.update(key.id, { lastUsedAt: new Date() });
    return true;
  }
}

/** Door reader: "Authorization: Bearer <token>" issued at pairing. */
@Injectable()
export class ReaderGuard implements CanActivate {
  constructor(private readonly crypto: CryptoService, @InjectRepository(DoorReader) private readonly readers: Repository<DoorReader>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AccessRequest>();
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m || !req.tenant) throw new UnauthorizedException();
    const r = await this.readers.findOne({ where: { tokenHash: this.crypto.sha256(m[1]), tenantId: req.tenant.id, revokedAt: IsNull() } });
    if (!r) throw new UnauthorizedException('READER_NOT_AUTHORISED');
    req.reader = { id: r.id, tenantId: r.tenantId, siteId: r.siteId, doorId: r.doorId };
    if (!r.lastSeenAt || Date.now() - r.lastSeenAt.getTime() > 5 * 60_000) await this.readers.update(r.id, { lastSeenAt: new Date() });
    return true;
  }
}
