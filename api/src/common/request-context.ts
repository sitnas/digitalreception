import { Request } from 'express';
import { Role, TenantStatus } from '../entities';

export interface AuthTenant { id: string; slug: string; name: string; status: TenantStatus }
export interface AuthUser { id: string; tenantId: string; email: string; displayName: string; role: Role; siteIds: string[]; mustChangePassword: boolean }
export interface AuthDevice { id: string; tenantId: string; name: string; siteId: string }

export interface AppRequest extends Request {
  tenant?: AuthTenant;
  user?: AuthUser;
  device?: AuthDevice;
}

export function clientIp(req: Request): string | null {
  // req.ip honours the "trust proxy" setting, so X-Forwarded-For is only used behind the configured proxy
  return (req.ip ?? '').replace(/^::ffff:/, '').slice(0, 45) || null;
}
