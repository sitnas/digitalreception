import { Request } from 'express';
import { Role, TenantStatus } from '../entities';

export interface AuthTenant { id: string; slug: string; name: string; status: TenantStatus }
export interface AuthUser { id: string; tenantId: string; email: string; displayName: string; role: Role; siteIds: string[]; mustChangePassword: boolean;
  /** Two-step verification is on for this user / required by the organisation but not yet set up. */
  mfaEnabled: boolean; mfaSetupRequired: boolean;
  /** This session was opened with single sign-on. */
  sso: boolean }
export interface AuthDevice { id: string; tenantId: string; name: string; siteId: string }
/** An employee using the phone app (token issued with the phone badge). */
export interface AuthEmployee { id: string; tenantId: string }

export interface AppRequest extends Request {
  tenant?: AuthTenant;
  user?: AuthUser;
  device?: AuthDevice;
  employee?: AuthEmployee;
}

export function clientIp(req: Request): string | null {
  // req.ip honours the "trust proxy" setting, so X-Forwarded-For is only used behind the configured proxy
  return (req.ip ?? '').replace(/^::ffff:/, '').slice(0, 45) || null;
}
