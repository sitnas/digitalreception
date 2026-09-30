import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { SESSION_COOKIE, SessionClaims } from '../common/guards';
import { AppRequest } from '../common/request-context';
import { User } from '../entities';

/** Opens a console session (password, password + code, or single sign-on). */
@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async start(user: User, req: AppRequest, res: Response, opts: { details?: Record<string, unknown>; via?: 'sso' } = {}) {
    const now = new Date();
    await this.users.update(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
    const claims: SessionClaims = { sub: user.id, tid: user.tenantId, sv: user.sessionVersion, ...(opts.via ? { via: opts.via } : {}) };
    const token = await this.jwt.signAsync(claims, { expiresIn: `${this.cfg.auth.sessionHours}h` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: this.cfg.auth.cookieSecure, sameSite: 'strict', path: '/api', maxAge: this.cfg.auth.sessionHours * 3_600_000,
    });
    const sso = opts.via === 'sso';
    req.user = { id: user.id, tenantId: user.tenantId, email: user.email, displayName: user.displayName, role: user.role, siteIds: [], mustChangePassword: !sso && user.mustChangePassword, mfaEnabled: !!user.mfaEnabledAt, mfaSetupRequired: false, sso };
    await this.audit.fromRequest(req, { action: 'LOGIN', entityType: 'user', entityId: user.id, details: opts.details });
    return { ok: true, mustChangePassword: req.user.mustChangePassword };
  }
}
