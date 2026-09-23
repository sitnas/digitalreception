import { ForbiddenException, Inject, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { NextFunction, Response } from 'express';
import { Repository } from 'typeorm';
import { Tenant, TenantStatus } from '../entities';
import { APP_CONFIG, AppConfig } from './app-config';
import { AppRequest, AuthTenant } from './request-context';

const TTL_MS = 60_000;

/**
 * Resolves the tenant of every request BEFORE any controller runs:
 *  - TENANCY_MODE=single    -> always DEFAULT_TENANT_SLUG (dedicated / on-premise installation);
 *  - TENANCY_MODE=subdomain -> <slug>.<BASE_DOMAIN> from the Host header (shared SaaS).
 * Cookies are host-only, so an admin session of tenant A is never even sent to tenant B.
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  private readonly cache = new Map<string, { tenant: AuthTenant | null; expires: number }>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  private slugFromHost(host: string | undefined): string | null {
    if (this.cfg.tenancy.mode === 'single') return this.cfg.tenancy.defaultSlug!;
    const h = (host ?? '').toLowerCase().split(':')[0];
    const base = this.cfg.tenancy.baseDomain!;
    if (h.endsWith(`.${base}`)) {
      const sub = h.slice(0, -(base.length + 1));
      return /^[a-z0-9-]{2,40}$/.test(sub) ? sub : null;
    }
    // Local development only: localhost falls back to DEFAULT_TENANT_SLUG if configured.
    if ((h === 'localhost' || h === '127.0.0.1') && this.cfg.env !== 'production') return this.cfg.tenancy.defaultSlug ?? null;
    return null;
  }

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    const slug = this.slugFromHost(req.headers.host);
    if (!slug) throw new NotFoundException('TENANT_NOT_FOUND');
    let hit = this.cache.get(slug);
    if (!hit || hit.expires < Date.now()) {
      const t = await this.tenants.findOne({ where: { slug } });
      hit = { tenant: t ? { id: t.id, slug: t.slug, name: t.name, status: t.status } : null, expires: Date.now() + TTL_MS };
      this.cache.set(slug, hit);
    }
    if (!hit.tenant) throw new NotFoundException('TENANT_NOT_FOUND');
    if (hit.tenant.status !== TenantStatus.ACTIVE) throw new ForbiddenException('TENANT_SUSPENDED');
    req.tenant = hit.tenant;
    next();
  }
}
