import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import type { AppKey } from './app-keys';
import type { AppRequest } from './request-context';

export * from './app-keys';

const APP_KEY = 'requiredApp';
/** The endpoint belongs to an app: refused with 403 APP_DISABLED while the organisation has it off. */
export const RequireApp = (app: AppKey) => SetMetadata(APP_KEY, app);

/** Global: runs after the tenant is resolved, before any other guard. Reads the database, so a switch applies at once. */
@Injectable()
export class AppsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const app = this.reflector.getAllAndOverride<AppKey | undefined>(APP_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!app) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) return true; // the tenant middleware has already refused the request
    const t = await this.tenants.findOne({ where: { id: req.tenant.id }, select: { id: true, apps: true } });
    if (!t?.apps.includes(app)) throw new ForbiddenException('APP_DISABLED');
    return true;
  }
}
