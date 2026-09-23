import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AdminAuthGuard, AllowPendingPasswordChange, CurrentUser, SESSION_COOKIE } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { User } from '../entities';

export class LoginDto {
  @IsEmail() @MaxLength(190) email: string;
  @IsString() @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}

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
  ) {}

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
      if (user && !locked && !valid) {
        const failed = user.failedLogins + 1;
        const lock = failed >= this.cfg.auth.maxFailedLogins ? new Date(now.getTime() + this.cfg.auth.lockMinutes * 60_000) : null;
        await this.users.update(user.id, { failedLogins: lock ? 0 : failed, lockedUntil: lock });
      }
      await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user?.id ?? null, details: { reason: !user ? 'unknown' : locked ? 'locked' : !user.active ? 'inactive' : 'password' } });
      throw new UnauthorizedException('INVALID_CREDENTIALS'); // same message in every case: no user enumeration
    }

    await this.users.update(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
    const token = await this.jwt.signAsync({ sub: user.id, tid: user.tenantId, sv: user.sessionVersion }, { expiresIn: `${this.cfg.auth.sessionHours}h` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: this.cfg.auth.cookieSecure, sameSite: 'strict', path: '/api', maxAge: this.cfg.auth.sessionHours * 3_600_000,
    });
    req.user = { id: user.id, tenantId: user.tenantId, email: user.email, displayName: user.displayName, role: user.role, siteIds: [], mustChangePassword: user.mustChangePassword };
    await this.audit.fromRequest(req, { action: 'LOGIN', entityType: 'user', entityId: user.id });
    return { ok: true, mustChangePassword: user.mustChangePassword };
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
