import { BadRequestException, Controller, Get, Inject, Logger, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { APP_CONFIG, AppConfig, SsoProviderId } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AdminAuthGuard, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role, SsoRequest, Tenant, User } from '../entities';
import { OidcProvider, SsoError } from './oidc';
import { SessionService } from './session.service';

export const SSO_BROWSER_COOKIE = 'rs_sso';
const REQUEST_TTL_MS = 10 * 60_000;
const PROVIDERS: SsoProviderId[] = ['microsoft', 'google'];

export class SsoStartQuery {
  @IsOptional() @IsIn(['login', 'link']) mode?: 'login' | 'link';
  @IsOptional() @IsIn(PROVIDERS) provider?: SsoProviderId;
  @IsOptional() @IsEmail() @MaxLength(190) email?: string;
}
export class SsoFinishQuery {
  @IsString() @MaxLength(200) code: string;
}

/**
 * Single sign-on with the organisation's Microsoft Entra ID or Google Workspace.
 *
 *  1. start (organisation's address): state, nonce and PKCE verifier are stored, a random cookie
 *     binds the attempt to this browser, and the browser goes to the provider;
 *  2. callback (the one address registered with the provider, shared by every organisation): the
 *     code is redeemed and the ID token verified; the browser is sent back to its organisation
 *     with a one-time hand-off code;
 *  3. finish (organisation's address): hand-off code + the browser cookie from step 1 open the
 *     session. A link stolen between steps is useless in another browser.
 *
 * Accounts are never created here: the person must already be a user of the console, with the
 * same email as in the directory.
 */
@Controller('auth/sso')
export class SsoController {
  private readonly log = new Logger('SSO');
  private readonly providers = new Map<SsoProviderId, OidcProvider>();

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(SsoRequest) private readonly requests: Repository<SsoRequest>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {
    for (const id of PROVIDERS) {
      const p = cfg.sso.providers[id];
      if (p) this.providers.set(id, new OidcProvider(id, p, cfg.sso.redirectUri!));
    }
  }

  /** Where the organisation's console lives, from the configuration only (never from request headers). */
  private origin(slug: string) {
    const u = new URL(this.cfg.sso.redirectUri!);
    if (this.cfg.tenancy.mode === 'single') return u.origin;
    return `${u.protocol}//${slug}.${this.cfg.tenancy.baseDomain}${u.port ? `:${u.port}` : ''}`;
  }

  private back(res: Response, path: string, error?: string) {
    res.redirect(302, error ? `${path}?sso_error=${encodeURIComponent(error)}` : path);
  }

  private cookieOptions() {
    // Lax, not Strict: the browser comes back from the provider's site and must still send it.
    return { httpOnly: true, secure: this.cfg.auth.cookieSecure, sameSite: 'lax' as const, path: '/api/auth/sso', maxAge: REQUEST_TTL_MS };
  }

  private async begin(req: AppRequest, res: Response, t: Pick<Tenant, 'id' | 'ssoOrgId'>, provider: SsoProviderId, mode: 'login' | 'link', userId: string | null, loginHint?: string) {
    const oidc = this.providers.get(provider);
    if (!oidc) return this.back(res, mode === 'link' ? '/admin/organisation' : '/admin/', 'SSO_NOT_CONFIGURED');
    await this.requests.delete({ expiresAt: LessThan(new Date()) });
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url'), codeVerifier = randomBytes(48).toString('base64url');
    const orgId = mode === 'link' ? null : t.ssoOrgId;
    let url: string;
    try { url = await oidc.authorizeUrl({ orgId, state, nonce, codeVerifier, loginHint }); } catch (e) {
      this.log.error(`${provider} discovery failed: ${(e as Error).message}`);
      return this.back(res, mode === 'link' ? '/admin/organisation' : '/admin/', 'PROVIDER_UNREACHABLE');
    }
    await this.requests.insert({
      tenantId: t.id, provider, mode, userId, stateHash: this.crypto.sha256(state), browserHash: this.crypto.sha256(browser),
      nonce, codeVerifier, handoffHash: null, subject: null, orgId: null, orgLabel: null, email: null, error: null,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    });
    res.cookie(SSO_BROWSER_COOKIE, browser, this.cookieOptions());
    res.redirect(302, url);
  }

  /** Sign-in button of the login page. */
  @Get('start')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async start(@Query() q: SsoStartQuery, @Req() req: AppRequest, @Res() res: Response) {
    if (q.mode === 'link') throw new BadRequestException('Use /auth/sso/link');
    const t = await this.tenants.findOneOrFail({ where: { id: req.tenant!.id }, select: { id: true, ssoProvider: true, ssoOrgId: true } });
    if (!t.ssoProvider || !t.ssoOrgId) return this.back(res, '/admin/', 'SSO_NOT_CONFIGURED');
    return this.begin(req, res, t, t.ssoProvider, 'login', null, q.email?.trim().toLowerCase());
  }

  /** "Connect Microsoft / Google" in the console: the SUPER_ADMIN signs in once with the company account. */
  @Get('link')
  @UseGuards(AdminAuthGuard)
  @Roles(Role.SUPER_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async link(@CurrentUser() me: AuthUser, @Query() q: SsoStartQuery, @Req() req: AppRequest, @Res() res: Response) {
    if (!q.provider) throw new BadRequestException('provider required');
    return this.begin(req, res, { id: me.tenantId, ssoOrgId: null }, q.provider, 'link', me.id);
  }

  /** The provider sends the browser here. No organisation in the address: the state says which one. */
  @Get('callback')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async callback(@Query() raw: Record<string, unknown>, @Res() res: Response) {
    // Providers add parameters of their own (session_state, iss, hd…): read only the ones used here.
    const param = (k: string, max: number) => (typeof raw[k] === 'string' && (raw[k] as string).length <= max ? (raw[k] as string) : undefined);
    const q = { code: param('code', 4000), state: param('state', 200), error: param('error', 200), error_description: param('error_description', 2000) };
    const r = q.state ? await this.requests.findOne({ where: { stateHash: this.crypto.sha256(q.state), handoffHash: IsNull(), expiresAt: MoreThan(new Date()) } }) : null;
    if (!r) { res.status(400).type('text/plain').send('Accesso scaduto o non valido. Torna alla pagina di accesso e riprova.'); return; }
    const t = await this.tenants.findOneOrFail({ where: { id: r.tenantId }, select: { id: true, slug: true } });
    const handoff = randomBytes(32).toString('base64url');
    let outcome: Partial<SsoRequest>;
    if (q.error || !q.code) {
      // The person cancelled or the provider refused (e.g. consent not granted by the IT administrator).
      outcome = { error: q.error === 'access_denied' ? 'CANCELLED' : 'PROVIDER_REFUSED' };
      this.log.warn(`${r.provider} returned ${q.error ?? 'no code'}${q.error_description ? `: ${q.error_description.slice(0, 200)}` : ''}`);
    } else {
      try {
        const orgId = r.mode === 'link' ? null : (await this.tenants.findOneOrFail({ where: { id: r.tenantId }, select: { id: true, ssoOrgId: true } })).ssoOrgId;
        const id = await this.providers.get(r.provider)!.redeem({ code: q.code, codeVerifier: r.codeVerifier, nonce: r.nonce, orgId });
        outcome = { subject: id.subject, orgId: id.orgId, orgLabel: id.orgLabel, email: id.email };
      } catch (e) {
        outcome = { error: e instanceof SsoError ? e.message.slice(0, 40) : 'PROVIDER_UNREACHABLE' };
        this.log.warn(`${r.provider} sign-in rejected: ${(e as Error).message}`);
      }
    }
    // Conditional on "not yet handed off": a replayed callback cannot overwrite the first outcome.
    const upd = await this.requests.update({ id: r.id, handoffHash: IsNull() }, { ...outcome, handoffHash: this.crypto.sha256(handoff) });
    if (!upd.affected) { res.status(400).type('text/plain').send('Accesso già completato.'); return; }
    res.redirect(302, `${this.origin(t.slug)}/api/auth/sso/finish?code=${handoff}`);
  }

  /** Back on the organisation's address: the same browser that started opens the session. */
  @Get('finish')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async finish(@Query() q: SsoFinishQuery, @Req() req: AppRequest, @Res() res: Response) {
    const tenantId = req.tenant!.id;
    const r = await this.requests.findOne({ where: { handoffHash: this.crypto.sha256(q.code), tenantId, expiresAt: MoreThan(new Date()) } });
    res.clearCookie(SSO_BROWSER_COOKIE, { path: '/api/auth/sso' });
    if (!r) return this.back(res, '/admin/', 'EXPIRED');
    const done = r.mode === 'link' ? '/admin/organisation' : '/admin/';
    const browser = String(req.cookies?.[SSO_BROWSER_COOKIE] ?? '');
    const sameBrowser = timingSafeEqual(Buffer.from(this.crypto.sha256(browser)), Buffer.from(r.browserHash));
    // One use: whoever deletes the row first wins.
    const del = await this.requests.delete({ id: r.id, handoffHash: r.handoffHash! });
    if (!del.affected) return this.back(res, done, 'EXPIRED');
    if (!sameBrowser) {
      await this.audit.fromRequest(req, { action: 'SSO_FAILED', details: { provider: r.provider, mode: r.mode, reason: 'OTHER_BROWSER' } });
      return this.back(res, done, 'OTHER_BROWSER');
    }
    if (r.error) {
      await this.audit.fromRequest(req, { action: 'SSO_FAILED', entityType: r.userId ? 'user' : undefined, entityId: r.userId, details: { provider: r.provider, mode: r.mode, reason: r.error } });
      return this.back(res, done, r.error);
    }
    return r.mode === 'link' ? this.finishLink(r, req, res) : this.finishLogin(r, req, res);
  }

  private async finishLink(r: SsoRequest, req: AppRequest, res: Response) {
    const admin = await this.users.findOne({ where: { id: r.userId!, tenantId: r.tenantId, active: true, role: Role.SUPER_ADMIN } });
    if (!admin) return this.back(res, '/admin/organisation', 'NOT_ALLOWED');
    await this.ds.transaction(async (em) => {
      const t = await em.findOneOrFail(Tenant, { where: { id: r.tenantId }, select: { id: true, ssoProvider: true, ssoOrgId: true } });
      const changed = t.ssoProvider !== r.provider || t.ssoOrgId !== r.orgId;
      // Another directory: accounts bound to the previous one must bind again, and the obligation
      // is lifted until someone has checked that signing in works.
      if (changed) await em.update(User, { tenantId: r.tenantId }, { ssoSubject: null });
      await em.update(Tenant, { id: r.tenantId }, { ssoProvider: r.provider, ssoOrgId: r.orgId, ssoOrgLabel: r.orgLabel, ssoLinkedAt: new Date(), ...(changed ? { ssoEnforced: false } : {}) });
    });
    req.user = { id: admin.id, tenantId: admin.tenantId, email: admin.email, displayName: admin.displayName, role: admin.role, siteIds: [], mustChangePassword: false, mfaEnabled: !!admin.mfaEnabledAt, mfaSetupRequired: false, sso: false };
    await this.audit.fromRequest(req, { action: 'SSO_LINKED', entityType: 'tenant', entityId: r.tenantId, details: { provider: r.provider, org: r.orgLabel } });
    return this.back(res, '/admin/organisation?sso=linked');
  }

  private async finishLogin(r: SsoRequest, req: AppRequest, res: Response) {
    const fail = async (reason: string, userId?: string) => {
      await this.audit.fromRequest(req, { action: 'LOGIN_FAILED', entityType: 'user', entityId: userId ?? null, details: { reason: `sso_${reason.toLowerCase()}`, provider: r.provider } });
      return this.back(res, '/admin/', reason);
    };
    const t = await this.tenants.findOneOrFail({ where: { id: r.tenantId }, select: { id: true, ssoProvider: true, ssoOrgId: true } });
    // The link may have changed while the person was at the provider.
    if (t.ssoProvider !== r.provider || t.ssoOrgId !== r.orgId) return fail('OTHER_DIRECTORY');
    const user = await this.users.findOne({ where: { tenantId: r.tenantId, email: r.email! } });
    if (!user || !user.active) return fail('NO_ACCOUNT', user?.id);
    if (user.ssoSubject && user.ssoSubject !== r.subject) return fail('ACCOUNT_MISMATCH', user.id);
    if (!user.ssoSubject) {
      const bound = await this.users.update({ id: user.id, ssoSubject: IsNull() }, { ssoSubject: r.subject });
      if (!bound.affected) return fail('ACCOUNT_MISMATCH', user.id);
    }
    await this.sessions.start(user, req, res, { details: { sso: r.provider }, via: 'sso' });
    return this.back(res, '/admin/');
  }
}
