import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { qrSvg } from '../common/exit-qr';
import { AdminAuthGuard, AllowPendingPasswordChange, CurrentUser, SESSION_COOKIE, SessionClaims } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../common/totp';
import { Tenant, User } from '../entities';
import { SessionService } from './session.service';

export class LoginDto {
  @IsEmail() @MaxLength(190) email: string;
  @IsString() @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}

/** 6-digit code from the authenticator app, or a recovery code (XXXXX-XXXXX). */
const SECOND_FACTOR = /^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/;

export class MfaLoginDto {
  @IsString() @MaxLength(2000) mfaToken: string;
  @IsString() @Matches(SECOND_FACTOR) code: string;
}

export class MfaCodeDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}

export class MfaDisableDto {
  @IsString() @MaxLength(200) password: string;
  @IsString() @Matches(SECOND_FACTOR) code: string;
}

const MFA_TOKEN_TTL = '5m';
const MFA_SECRET_CTX = 'user.mfaSecret';

/** Placeholder hash used to keep response time constant when the email does not exist. */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly keys: TenantKeysService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly sessions: SessionService,
  ) {}

  /** Reloads the user with the two-step verification columns (not selected by default). */
  private withMfa(id: string, tenantId: string) {
    return this.users.createQueryBuilder('u').addSelect(['u.passwordHash', 'u.mfaSecretEnc', 'u.mfaLastStep', 'u.mfaRecoveryHashes'])
      .where('u.id = :id AND u.tenantId = :tid', { id, tid: tenantId }).getOne();
  }

  /**
   * Checks an authenticator code or a recovery code and consumes it atomically: the conditional
   * UPDATE makes a replayed code (or two requests racing with the same code) fail.
   */
  private async checkSecondFactor(user: User, code: string): Promise<'totp' | 'recovery' | null> {
    if (!user.mfaSecretEnc) return null;
    if (/^\d{6}$/.test(code)) {
      const secret = (await this.keys.forTenant(user.tenantId)).decrypt(user.mfaSecretEnc, MFA_SECRET_CTX)!;
      const step = verifyTotp(secret, code, user.mfaLastStep);
      if (step === null) return null;
      const r = await this.users.createQueryBuilder().update(User).set({ mfaLastStep: step })
        .where('id = :id AND (mfaLastStep IS NULL OR mfaLastStep < :step)', { id: user.id, step }).execute();
      return r.affected ? 'totp' : null;
    }
    const hashes: string[] = JSON.parse(user.mfaRecoveryHashes ?? '[]');
    const h = hashRecoveryCode(code);
    if (!hashes.includes(h)) return null;
    const r = await this.users.createQueryBuilder().update(User).set({ mfaRecoveryHashes: JSON.stringify(hashes.filter((x) => x !== h)) })
      .where('id = :id AND mfaRecoveryHashes = :old', { id: user.id, old: user.mfaRecoveryHashes }).execute();
    return r.affected ? 'recovery' : null;
  }

  /** Counts a failed attempt (password or code) towards the temporary lock. */
  private async failAttempt(user: User, now: Date) {
    const failed = user.failedLogins + 1;
    const lock = failed >= this.cfg.auth.maxFailedLogins ? new Date(now.getTime() + this.cfg.auth.lockMinutes * 60_000) : null;
    await this.users.update(user.id, { failedLogins: lock ? 0 : failed, lockedUntil: lock });
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .where('u.tenantId = :tid AND u.email = :email', { tid: req.tenant!.id, email }).getOne();
    const now = new Date();
    const valid = await this.crypto.verifyPassword(dto.password, user?.passwordHash ?? DUMMY_HASH);
    const locked = !!user?.lockedUntil && user.lockedUntil > now;

    if (!user || !user.active || locked || !valid) {
      if (user && !locked && !valid) await this.failAttempt(user, now);
      await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user?.id ?? null, details: { reason: !user ? 'unknown' : locked ? 'locked' : !user.active ? 'inactive' : 'password' } });
      throw new UnauthorizedException('INVALID_CREDENTIALS'); // same message in every case: no user enumeration
    }

    // The password is right, but the organisation signs in through its directory: only the
    // emergency accounts may still use a password.
    if (!user.ssoExempt) {
      const t = await this.tenants.findOne({ where: { id: user.tenantId }, select: { id: true, ssoEnforced: true, ssoProvider: true, ssoOrgId: true } });
      if (t?.ssoEnforced && t.ssoOrgId && t.ssoProvider && this.cfg.sso.providers[t.ssoProvider]) {
        await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, details: { reason: 'sso_required' } });
        throw new ForbiddenException('SSO_REQUIRED');
      }
    }

    if (user.mfaEnabledAt) {
      // Password is right: no session yet, only a 5-minute ticket for the code step. Failed codes
      // keep counting towards the lock, so the password alone does not allow guessing codes.
      const claims: SessionClaims = { sub: user.id, tid: user.tenantId, sv: user.sessionVersion, typ: 'mfa' };
      return { mfaRequired: true, mfaToken: await this.jwt.signAsync(claims, { expiresIn: MFA_TOKEN_TTL }) };
    }
    return this.sessions.start(user, req, res);
  }

  /** Second step of the login: the code from the authenticator app or a recovery code. */
  @Post('login/mfa')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async loginMfa(@Body() dto: MfaLoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    let claims: SessionClaims;
    try { claims = await this.jwt.verifyAsync<SessionClaims>(dto.mfaToken); } catch { throw new UnauthorizedException('MFA_SESSION_EXPIRED'); }
    if (claims.typ !== 'mfa' || claims.tid !== req.tenant!.id) throw new UnauthorizedException('MFA_SESSION_EXPIRED');
    const user = await this.withMfa(claims.sub, claims.tid);
    const now = new Date();
    if (!user || !user.active || user.sessionVersion !== claims.sv || !user.mfaEnabledAt) throw new UnauthorizedException('MFA_SESSION_EXPIRED');
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, details: { reason: 'locked' } });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const method = await this.checkSecondFactor(user, dto.code.trim());
    if (!method) {
      await this.failAttempt(user, now);
      await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, details: { reason: 'mfa' } });
      throw new UnauthorizedException('MFA_CODE_INVALID');
    }
    return this.sessions.start(user, req, res, { details: { mfa: method } });
  }

  // -------------------------------------------------------- two-step verification (own account)

  @Get('mfa')
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  async mfaStatus(@CurrentUser() me: AuthUser) {
    const user = (await this.withMfa(me.id, me.tenantId))!;
    const required = await this.tenants.exist({ where: { id: me.tenantId, mfaRequired: true } });
    return { enabled: !!user.mfaEnabledAt, enabledAt: user.mfaEnabledAt, required, recoveryCodesLeft: user.mfaEnabledAt ? JSON.parse(user.mfaRecoveryHashes ?? '[]').length : 0 };
  }

  /** Starts enrolment: a new secret, shown as QR code and as text for manual entry. Replaces an unfinished one. */
  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async mfaSetup(@CurrentUser() me: AuthUser, @Req() req: AppRequest) {
    if (me.mfaEnabled) throw new ConflictException('MFA_ALREADY_ENABLED');
    const secret = newTotpSecret();
    const tc = await this.keys.forTenant(me.tenantId);
    await this.users.update({ id: me.id, tenantId: me.tenantId }, { mfaSecretEnc: tc.encrypt(secret, MFA_SECRET_CTX), mfaLastStep: null, mfaRecoveryHashes: null });
    const url = otpauthUrl(secret, req.tenant!.name, me.email);
    return { secret, otpauthUrl: url, qrSvg: await qrSvg(url) };
  }

  /** Confirms enrolment with a first code; returns the recovery codes, shown only this once. */
  @Post('mfa/enable')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async mfaEnable(@CurrentUser() me: AuthUser, @Body() dto: MfaCodeDto, @Req() req: AppRequest) {
    if (me.mfaEnabled) throw new ConflictException('MFA_ALREADY_ENABLED');
    const user = (await this.withMfa(me.id, me.tenantId))!;
    if (!user.mfaSecretEnc) throw new ConflictException('MFA_SETUP_NOT_STARTED');
    if ((await this.checkSecondFactor(user, dto.code)) !== 'totp') throw new UnauthorizedException('MFA_CODE_INVALID');
    const codes = newRecoveryCodes();
    await this.users.update(user.id, { mfaEnabledAt: new Date(), mfaRecoveryHashes: JSON.stringify(codes.map(hashRecoveryCode)) });
    await this.audit.fromRequest(req, { action: 'MFA_ENABLED', entityType: 'user', entityId: user.id });
    return { recoveryCodes: codes };
  }

  /** New recovery codes (the old ones stop working). Needs a current code from the app. */
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaRecoveryCodes(@CurrentUser() me: AuthUser, @Body() dto: MfaCodeDto, @Req() req: AppRequest) {
    const user = (await this.withMfa(me.id, me.tenantId))!;
    if (!user.mfaEnabledAt) throw new ConflictException('MFA_NOT_ENABLED');
    if ((await this.checkSecondFactor(user, dto.code)) !== 'totp') throw new UnauthorizedException('MFA_CODE_INVALID');
    const codes = newRecoveryCodes();
    await this.users.update(user.id, { mfaRecoveryHashes: JSON.stringify(codes.map(hashRecoveryCode)) });
    await this.audit.fromRequest(req, { action: 'MFA_RECOVERY_CODES_REGENERATED', entityType: 'user', entityId: user.id });
    return { recoveryCodes: codes };
  }

  /** Turns two-step verification off: password and a code are both required. Not allowed when the organisation requires it. */
  @Post('mfa/disable')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaDisable(@CurrentUser() me: AuthUser, @Body() dto: MfaDisableDto, @Req() req: AppRequest) {
    if (await this.tenants.exist({ where: { id: me.tenantId, mfaRequired: true } })) throw new ForbiddenException('MFA_REQUIRED_BY_ORGANISATION');
    const user = (await this.withMfa(me.id, me.tenantId))!;
    if (!user.mfaEnabledAt) throw new ConflictException('MFA_NOT_ENABLED');
    if (!(await this.crypto.verifyPassword(dto.password, user.passwordHash))) throw new UnauthorizedException('INVALID_CREDENTIALS');
    if (!(await this.checkSecondFactor(user, dto.code.trim()))) throw new UnauthorizedException('MFA_CODE_INVALID');
    await this.users.update(user.id, { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: null });
    await this.audit.fromRequest(req, { action: 'MFA_DISABLED', entityType: 'user', entityId: user.id });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  async logout(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    // Revoke every session of this user, not only the cookie in this browser.
    await this.users.increment({ id: user.id }, 'sessionVersion', 1);
    res.clearCookie(SESSION_COOKIE, { path: '/api' });
    await this.audit.fromRequest(req, { action: 'LOGOUT', entityType: 'user', entityId: user.id });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const full = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .where('u.id = :id AND u.tenantId = :tid', { id: user.id, tid: user.tenantId }).getOneOrFail();
    if (!(await this.crypto.verifyPassword(dto.currentPassword, full.passwordHash))) throw new UnauthorizedException('INVALID_CREDENTIALS');
    if (dto.currentPassword === dto.newPassword) throw new UnauthorizedException('PASSWORD_REUSED');
    await this.users.update(user.id, {
      passwordHash: await this.crypto.hashPassword(dto.newPassword), mustChangePassword: false, sessionVersion: full.sessionVersion + 1,
    });
    res.clearCookie(SESSION_COOKIE, { path: '/api' });
    await this.audit.fromRequest(req, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id });
    return { ok: true, reloginRequired: true };
  }
}
