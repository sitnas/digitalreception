import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Device, Role, User } from '../entities';
import { CryptoService } from './crypto.service';
import { AppRequest, AuthDevice, AuthUser } from './request-context';

export const SESSION_COOKIE = 'rs_session';
export const CSRF_HEADER = 'x-requested-with';
const ROLES_KEY = 'roles';
const ALLOW_PWD_CHANGE_KEY = 'allowPendingPasswordChange';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Endpoint reachable even when the user must still change the initial password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PWD_CHANGE_KEY, true);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().user!);
export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().device!);
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().tenant!);

export interface SessionClaims { sub: string; tid: string; sv: number }

/**
 * Admin console guard:
 *  - session JWT in an HttpOnly, Secure, SameSite=Strict cookie (not readable by JS);
 *  - user reloaded from DB on each request, so deactivation / role change / logout-all are immediate;
 *  - CSRF defence in depth: state-changing requests must carry a custom header;
 *  - role-based access via @Roles().
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== 'reception-admin') {
      throw new ForbiddenException('Missing CSRF header');
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();
    let claims: SessionClaims;
    try { claims = await this.jwt.verifyAsync<SessionClaims>(token); } catch { throw new UnauthorizedException(); }
    // A session is valid only on the tenant that issued it.
    if (!req.tenant || claims.tid !== req.tenant.id) throw new UnauthorizedException();

    const user = await this.users.findOne({ where: { id: claims.sub, tenantId: req.tenant.id }, relations: { sites: true } });
    if (!user || !user.active || user.sessionVersion !== claims.sv) throw new UnauthorizedException();

    const authUser: AuthUser = {
      id: user.id, tenantId: user.tenantId, email: user.email, displayName: user.displayName, role: user.role,
      siteIds: user.sites.map((s) => s.id), mustChangePassword: user.mustChangePassword,
    };
    req.user = authUser;

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PWD_CHANGE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (authUser.mustChangePassword && !allowPending) throw new ForbiddenException('PASSWORD_CHANGE_REQUIRED');

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(authUser.role)) throw new ForbiddenException();
    return true;
  }
}

/** Tablet guard: opaque bearer token, looked up by SHA-256 hash; revoked devices are rejected. */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly crypto: CryptoService,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException();
    if (!req.tenant) throw new UnauthorizedException();
    const device = await this.devices.findOne({ where: { tokenHash: this.crypto.sha256(m[1]), tenantId: req.tenant.id, revokedAt: IsNull() } });
    if (!device) throw new UnauthorizedException('DEVICE_NOT_AUTHORISED');
    const d: AuthDevice = { id: device.id, tenantId: device.tenantId, name: device.name, siteId: device.siteId };
    req.device = d;
    const now = Date.now();
    if (!device.lastSeenAt || now - device.lastSeenAt.getTime() > 5 * 60_000) {
      await this.devices.update(device.id, { lastSeenAt: new Date(now) });
    }
    return true;
  }
}

/** Throws unless the user may act on the given site. SUPER_ADMIN sees every site. */
export function assertSiteAccess(user: AuthUser, siteId: string): void {
  if (user.role === Role.SUPER_ADMIN) return;
  if (!user.siteIds.includes(siteId)) throw new ForbiddenException('No access to this site');
}

/** Sites the user can see: undefined means "all". */
export function visibleSiteIds(user: AuthUser): string[] | undefined {
  return user.role === Role.SUPER_ADMIN ? undefined : user.siteIds;
}
