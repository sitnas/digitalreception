import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, Like, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { MailService } from '../common/mail.service';
import { AdminAuthGuard, CurrentUser, Roles, assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { isValidTimeZone } from '../common/time.util';
import { noticeTemplate } from '../database/notice-templates';
import { AccessRule, AuditLog, CountryPolicy, Device, Door, Employee, Host, PairingCode, PrivacyNotice, Role, Site, Tenant, User } from '../entities';
import { TenantKeysService } from '../common/tenant-keys.service';
import {
  AuditExportQueryDto, AuditQueryDto, CreateHostDto, CreateNoticeDto, CreatePolicyDto, CreateSiteDto, CreateUserDto, PairingCodeDto, ResetPasswordDto,
  UpdateHostDto, UpdateOrganisationDto, UpdatePolicyDto, UpdateSiteDto, UpdateUserDto,
} from './admin.dto';
import { csvCell } from './csv';

const PAIRING_TTL_MIN = 15;
const NONE = ['00000000-0000-0000-0000-000000000000'];

/**
 * Tenant administration. EVERY query is filtered by user.tenantId: the tenant comes from the
 * verified session, never from request parameters.
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class ManagementController {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(PairingCode) private readonly codes: Repository<PairingCode>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(CountryPolicy) private readonly policies: Repository<CountryPolicy>,
    @InjectRepository(PrivacyNotice) private readonly notices: Repository<PrivacyNotice>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(Host) private readonly hosts: Repository<Host>,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Door) private readonly doors: Repository<Door>,
    @InjectRepository(AccessRule) private readonly rules: Repository<AccessRule>,
    private readonly keys: TenantKeysService,
  ) {}

  /**
   * Employees a SITE_MANAGER may pick: those allowed through a door of their sites, the same rule
   * as the employee list. null = no restriction (SUPER_ADMIN).
   */
  private async reachableEmployees(user: AuthUser): Promise<Set<string> | null> {
    const ids = visibleSiteIds(user);
    if (!ids) return null;
    const doors = ids.length ? await this.doors.find({ where: { tenantId: user.tenantId, siteId: In(ids) }, select: { id: true } }) : [];
    if (!doors.length) return new Set();
    const rules = await this.rules.find({ where: { tenantId: user.tenantId, doorId: In(doors.map((d) => d.id)) }, select: { id: true, employeeId: true } });
    return new Set(rules.map((r) => r.employeeId));
  }

  /** An active SUPER_ADMIN who may still sign in with the password: the way back in if the directory is unreachable. */
  private hasEmergencyAdmin(tenantId: string, exceptUserId?: string) {
    return this.users.createQueryBuilder('u')
      .where('u.tenantId = :tid AND u.active = 1 AND u.ssoExempt = 1 AND u.role = :role', { tid: tenantId, role: Role.SUPER_ADMIN })
      .andWhere(exceptUserId ? 'u.id <> :except' : '1=1', { except: exceptUserId }).getExists();
  }

  private async limits(tenantId: string) {
    return this.tenants.findOneOrFail({ where: { id: tenantId }, select: { id: true, maxSites: true, maxDevices: true, maxUsers: true } });
  }

  // --------------------------------------------------------- organisation
  @Get('organisation')
  @Roles(Role.SUPER_ADMIN)
  async organisation(@CurrentUser() user: AuthUser) {
    const t = await this.tenants.findOneOrFail({ where: { id: user.tenantId } });
    const [sites, devices, users] = await Promise.all([
      this.sites.count({ where: { tenantId: user.tenantId, active: true } }),
      this.devices.count({ where: { tenantId: user.tenantId, revokedAt: IsNull() } }),
      this.users.count({ where: { tenantId: user.tenantId, active: true } }),
    ]);
    const sso = {
      available: (['microsoft', 'google'] as const).filter((p) => !!this.cfg.sso.providers[p]),
      provider: t.ssoProvider, org: t.ssoOrgLabel, linkedAt: t.ssoLinkedAt, enforced: t.ssoEnforced,
      emergencyAdmin: await this.hasEmergencyAdmin(user.tenantId), signedInWithSso: user.sso,
    };
    return { name: t.name, slug: t.slug, logo: t.logoDataUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, mfaRequired: t.mfaRequired, sso, email: { enabled: this.mail.enabled, from: this.mail.enabled ? this.mail.from : null }, usage: { sites, devices, users }, limits: { sites: t.maxSites, devices: t.maxDevices, users: t.maxUsers } };
  }

  @Patch('organisation')
  @Roles(Role.SUPER_ADMIN)
  async updateOrganisation(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganisationDto, @Req() req: AppRequest) {
    const patch: Partial<Tenant> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.logoDataUrl !== undefined) patch.logoDataUrl = dto.logoDataUrl || null;
    if (dto.primaryColor !== undefined) patch.primaryColor = dto.primaryColor ? dto.primaryColor.toUpperCase() : null;
    if (dto.secondaryColor !== undefined) patch.secondaryColor = dto.secondaryColor ? dto.secondaryColor.toUpperCase() : null;
    if (dto.mfaRequired !== undefined) {
      // Whoever turns the requirement on must already use it: proves the setup works for this organisation.
      if (dto.mfaRequired && !user.mfaEnabled) throw new ConflictException('MFA_SELF_FIRST');
      patch.mfaRequired = dto.mfaRequired;
    }
    if (dto.ssoEnforced !== undefined) {
      if (dto.ssoEnforced) {
        const t = await this.tenants.findOneOrFail({ where: { id: user.tenantId }, select: { id: true, ssoOrgId: true } });
        if (!t.ssoOrgId) throw new ConflictException('SSO_NOT_LINKED');
        // Same idea: signing in through the directory must have worked at least once, for this admin, now.
        if (!user.sso) throw new ConflictException('SSO_SELF_FIRST');
        if (!(await this.hasEmergencyAdmin(user.tenantId))) throw new ConflictException('SSO_EMERGENCY_ADMIN_REQUIRED');
      }
      patch.ssoEnforced = dto.ssoEnforced;
    }
    await this.tenants.update(user.tenantId, patch);
    await this.audit.fromRequest(req, { action: 'ORGANISATION_UPDATED', entityType: 'tenant', entityId: user.tenantId, details: { name: dto.name, logoChanged: dto.logoDataUrl !== undefined, primaryColor: dto.primaryColor, secondaryColor: dto.secondaryColor, mfaRequired: dto.mfaRequired, ssoEnforced: dto.ssoEnforced } });
    return { ok: true };
  }

  /** Disconnects the directory: everyone signs in with the password again. */
  @Post('organisation/sso/unlink')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  async unlinkSso(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    await this.tenants.update(user.tenantId, { ssoProvider: null, ssoOrgId: null, ssoOrgLabel: null, ssoLinkedAt: null, ssoEnforced: false });
    await this.users.update({ tenantId: user.tenantId }, { ssoSubject: null });
    await this.audit.fromRequest(req, { action: 'SSO_UNLINKED', entityType: 'tenant', entityId: user.tenantId });
    return { ok: true };
  }

  /** Sends a test message to the signed-in administrator. */
  @Post('organisation/test-email')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async testEmail(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    const t = await this.tenants.findOneOrFail({ where: { id: user.tenantId }, select: { id: true, name: true } });
    const res = await this.mail.sendTest(user.email, t.name);
    await this.audit.fromRequest(req, { action: 'EMAIL_TEST', entityType: 'tenant', entityId: user.tenantId, details: { ok: res.ok } });
    return { ...res, to: user.email };
  }

  // ---------------------------------------------------------------- sites
  @Get('sites')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR)
  listSites(@CurrentUser() user: AuthUser) {
    const ids = visibleSiteIds(user);
    return this.sites.find({ where: { tenantId: user.tenantId, ...(ids ? { id: In(ids.length ? ids : NONE) } : {}) }, order: { countryCode: 'ASC', name: 'ASC' } });
  }

  @Post('sites')
  @Roles(Role.SUPER_ADMIN)
  async createSite(@CurrentUser() user: AuthUser, @Body() dto: CreateSiteDto, @Req() req: AppRequest) {
    if (!isValidTimeZone(dto.timezone)) throw new BadRequestException('INVALID_TIMEZONE');
    if (!(await this.policies.exist({ where: { tenantId: user.tenantId, countryCode: dto.countryCode } }))) throw new BadRequestException('UNKNOWN_COUNTRY');
    if (await this.sites.exist({ where: { tenantId: user.tenantId, code: dto.code } })) throw new ConflictException('SITE_CODE_EXISTS');
    const { maxSites } = await this.limits(user.tenantId);
    if (maxSites !== null && (await this.sites.count({ where: { tenantId: user.tenantId, active: true } })) >= maxSites) throw new ForbiddenException('PLAN_LIMIT_SITES');
    const site = await this.sites.save(this.sites.create({ ...dto, tenantId: user.tenantId, active: true }));
    await this.audit.fromRequest(req, { action: 'SITE_CREATED', entityType: 'site', entityId: site.id, siteId: site.id, details: { ...dto } });
    return site;
  }

  @Patch('sites/:id')
  @Roles(Role.SUPER_ADMIN)
  async updateSite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteDto, @Req() req: AppRequest) {
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw new BadRequestException('INVALID_TIMEZONE');
    const site = await this.sites.findOne({ where: { id, tenantId: user.tenantId } });
    if (!site) throw new NotFoundException();
    if (dto.active === true && !site.active) {
      const { maxSites } = await this.limits(user.tenantId);
      if (maxSites !== null && (await this.sites.count({ where: { tenantId: user.tenantId, active: true } })) >= maxSites) throw new ForbiddenException('PLAN_LIMIT_SITES');
    }
    await this.sites.update({ id, tenantId: user.tenantId }, dto);
    await this.audit.fromRequest(req, { action: 'SITE_UPDATED', entityType: 'site', entityId: id, siteId: id, details: { ...dto } });
    return this.sites.findOneOrFail({ where: { id, tenantId: user.tenantId } });
  }

  // -------------------------------------------------------------- devices
  @Get('devices')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  listDevices(@CurrentUser() user: AuthUser) {
    const ids = visibleSiteIds(user);
    return this.devices.find({ where: { tenantId: user.tenantId, ...(ids ? { siteId: In(ids.length ? ids : NONE) } : {}) }, relations: { site: true }, order: { createdAt: 'DESC' } });
  }

  @Post('devices/pairing-code')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async pairingCode(@CurrentUser() user: AuthUser, @Body() dto: PairingCodeDto, @Req() req: AppRequest) {
    assertSiteAccess(user, dto.siteId);
    const site = await this.sites.findOne({ where: { id: dto.siteId, tenantId: user.tenantId, active: true } });
    if (!site) throw new NotFoundException('SITE_NOT_FOUND');
    const { maxDevices } = await this.limits(user.tenantId);
    if (maxDevices !== null && (await this.devices.count({ where: { tenantId: user.tenantId, revokedAt: IsNull() } })) >= maxDevices) throw new ForbiddenException('PLAN_LIMIT_DEVICES');
    const code = this.crypto.randomCode(8);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MIN * 60_000);
    await this.codes.save(this.codes.create({ tenantId: user.tenantId, siteId: site.id, deviceName: dto.name, codeHash: this.crypto.sha256(code), expiresAt, usedAt: null, createdBy: user.id }));
    await this.audit.fromRequest(req, { action: 'PAIRING_CODE_CREATED', entityType: 'site', entityId: site.id, siteId: site.id, details: { deviceName: dto.name } });
    return { code, expiresAt }; // shown once, only its hash is stored
  }

  @Post('devices/:id/revoke')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const d = await this.devices.findOne({ where: { id, tenantId: user.tenantId } });
    if (!d) throw new NotFoundException();
    assertSiteAccess(user, d.siteId);
    await this.devices.update({ id, tenantId: user.tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.audit.fromRequest(req, { action: 'DEVICE_REVOKED', entityType: 'device', entityId: id, siteId: d.siteId });
    return { ok: true };
  }

  // ---------------------------------------------------------------- hosts
  /**
   * People who can be visited. SUPER_ADMIN manages the whole directory; a SITE_MANAGER sees and edits
   * only hosts linked to their sites and can assign them only to their own sites.
   */
  @Get('hosts')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async listHosts(@CurrentUser() user: AuthUser) {
    const all = await this.hosts.find({ where: { tenantId: user.tenantId }, relations: { sites: true }, order: { lastName: 'ASC', firstName: 'ASC' } });
    const ids = visibleSiteIds(user);
    const rows = ids ? all.filter((h) => h.sites.some((s) => ids.includes(s.id))) : all;
    // Linked employees who activated the phone app can already invite their guests from it.
    const linked = rows.map((h) => h.employeeId).filter((x): x is string => !!x);
    const withApp = new Set(linked.length ? (await this.employees.createQueryBuilder('e').select('e.id', 'id')
      .where('e.tenantId = :tid AND e.id IN (:...ids) AND e.appTokenHash IS NOT NULL AND e.active = 1', { tid: user.tenantId, ids: linked }).getRawMany<{ id: string }>()).map((r) => r.id) : []);
    return rows.map((h) => ({ ...h, appInvites: !!h.employeeId && withApp.has(h.employeeId) }));
  }

  /** Employees to pick from when adding a person to visit (names decrypted here, never stored in clear). */
  @Get('hosts/employees')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async hostCandidates(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    const [all, hosts] = await Promise.all([
      this.employees.find({ where: { tenantId: user.tenantId, active: true }, select: { id: true, externalId: true, firstNameEnc: true, lastNameEnc: true, emailEnc: true, departmentEnc: true, jobTitleEnc: true } }),
      this.hosts.find({ where: { tenantId: user.tenantId }, select: { id: true, employeeId: true } }),
    ]);
    const hostOf = new Map(hosts.filter((h) => h.employeeId).map((h) => [h.employeeId!, h.id]));
    const reachable = await this.reachableEmployees(user);
    const visible = reachable ? all.filter((e) => reachable.has(e.id)) : all;
    const tc = await this.keys.forTenant(user.tenantId);
    await this.audit.fromRequest(req, { action: 'EMPLOYEES_VIEW', details: { count: visible.length, purpose: 'hosts' } });
    return visible.map((e) => ({
      id: e.id, externalId: e.externalId,
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'),
      email: tc.decrypt(e.emailEnc, 'employee.email'), department: tc.decrypt(e.departmentEnc, 'employee.department'), jobTitle: tc.decrypt(e.jobTitleEnc, 'employee.jobTitle'),
      hostId: hostOf.get(e.id) ?? null,
    })).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  }

  /** The employee's identity as a person to visit. Throws if the employee is unknown or already somebody's entry. */
  private async employeeAsHost(user: AuthUser, employeeId: string, exceptHostId?: string) {
    const tenantId = user.tenantId;
    const e = await this.employees.findOne({ where: { id: employeeId, tenantId, active: true } });
    const reachable = await this.reachableEmployees(user);
    if (!e || (reachable && !reachable.has(e.id))) throw new BadRequestException('EMPLOYEE_NOT_FOUND');
    const taken = await this.hosts.findOne({ where: { tenantId, employeeId }, select: { id: true } });
    if (taken && taken.id !== exceptHostId) throw new ConflictException('EMPLOYEE_ALREADY_HOST');
    const tc = await this.keys.forTenant(tenantId);
    return {
      employeeId: e.id, firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName')!, lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName')!,
      email: tc.decrypt(e.emailEnc, 'employee.email'), department: tc.decrypt(e.departmentEnc, 'employee.department'), jobTitle: tc.decrypt(e.jobTitleEnc, 'employee.jobTitle'),
    };
  }

  private async hostSites(user: AuthUser, siteIds: string[]) {
    if (!siteIds.length) throw new BadRequestException('HOST_SITE_REQUIRED');
    siteIds.forEach((id) => assertSiteAccess(user, id));
    return this.tenantSites(user.tenantId, siteIds);
  }

  @Post('hosts')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async createHost(@CurrentUser() user: AuthUser, @Body() dto: CreateHostDto, @Req() req: AppRequest) {
    const { siteIds, employeeId, ...fields } = dto;
    // From an employee: name and email are theirs; department, job title and phone typed here win.
    const emp = employeeId ? await this.employeeAsHost(user, employeeId) : null;
    const host = await this.hosts.save(this.hosts.create({
      department: null, jobTitle: null, email: null, phone: null, employeeId: null, ...fields,
      ...(emp ? { employeeId: emp.employeeId, firstName: emp.firstName, lastName: emp.lastName, email: emp.email, department: fields.department || emp.department, jobTitle: fields.jobTitle || emp.jobTitle } : {}),
      tenantId: user.tenantId, sites: await this.hostSites(user, siteIds), active: true,
    }));
    await this.audit.fromRequest(req, { action: 'HOST_CREATED', entityType: 'host', entityId: host.id, details: { siteIds, employeeId: emp?.employeeId } });
    return { id: host.id };
  }

  @Patch('hosts/:id')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async updateHost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHostDto, @Req() req: AppRequest) {
    const host = await this.hosts.findOne({ where: { id, tenantId: user.tenantId }, relations: { sites: true } });
    if (!host) throw new NotFoundException();
    const ids = visibleSiteIds(user);
    if (ids && !host.sites.some((s) => ids.includes(s.id))) throw new NotFoundException();
    const { siteIds, employeeId, firstName, lastName, email, ...fields } = dto;
    Object.assign(host, fields);
    // Name and email of a person linked to an employee come from the employee record.
    if (employeeId === null || (employeeId === undefined && !host.employeeId)) {
      Object.assign(host, { employeeId: null, ...(firstName !== undefined ? { firstName } : {}), ...(lastName !== undefined ? { lastName } : {}), ...(email !== undefined ? { email } : {}) });
    } else if (employeeId !== undefined) {
      const emp = await this.employeeAsHost(user, employeeId, host.id);
      Object.assign(host, { employeeId: emp.employeeId, firstName: emp.firstName, lastName: emp.lastName, email: emp.email, department: host.department || emp.department, jobTitle: host.jobTitle || emp.jobTitle });
    }
    if (siteIds !== undefined) {
      // Sites the caller cannot see stay as they are: a site manager never removes another site's link.
      const hidden = ids ? host.sites.filter((s) => !ids.includes(s.id)) : [];
      siteIds.forEach((sid) => assertSiteAccess(user, sid));
      host.sites = [...hidden, ...(await this.tenantSites(user.tenantId, siteIds))];
      if (!host.sites.length) throw new BadRequestException('HOST_SITE_REQUIRED');
    }
    await this.hosts.save(host);
    await this.audit.fromRequest(req, { action: 'HOST_UPDATED', entityType: 'host', entityId: id, details: { siteIds, active: dto.active, employeeId } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- users
  @Get('users')
  @Roles(Role.SUPER_ADMIN)
  async listUsers(@CurrentUser() user: AuthUser) {
    const rows = await this.users.find({ where: { tenantId: user.tenantId }, relations: { sites: true }, order: { displayName: 'ASC' } });
    return rows.map(({ ssoSubject, ...u }) => ({ ...u, ssoBound: !!ssoSubject }));
  }

  private async tenantSites(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    const found = await this.sites.findBy({ tenantId, id: In(ids) });
    if (found.length !== new Set(ids).size) throw new BadRequestException('UNKNOWN_SITE');
    return found;
  }

  @Post('users')
  @Roles(Role.SUPER_ADMIN)
  async createUser(@CurrentUser() me: AuthUser, @Body() dto: CreateUserDto, @Req() req: AppRequest) {
    if (await this.users.exist({ where: { tenantId: me.tenantId, email: dto.email } })) throw new ConflictException('EMAIL_EXISTS');
    const { maxUsers } = await this.limits(me.tenantId);
    if (maxUsers !== null && (await this.users.count({ where: { tenantId: me.tenantId, active: true } })) >= maxUsers) throw new ForbiddenException('PLAN_LIMIT_USERS');
    const user = await this.users.save(this.users.create({
      tenantId: me.tenantId, email: dto.email, displayName: dto.displayName, role: dto.role, sites: await this.tenantSites(me.tenantId, dto.siteIds),
      active: true, mustChangePassword: true, passwordHash: await this.crypto.hashPassword(dto.temporaryPassword),
    }));
    await this.audit.fromRequest(req, { action: 'USER_CREATED', entityType: 'user', entityId: user.id, details: { role: dto.role, siteIds: dto.siteIds } });
    return { id: user.id };
  }

  @Patch('users/:id')
  @Roles(Role.SUPER_ADMIN)
  async updateUser(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() req: AppRequest) {
    const user = await this.users.findOne({ where: { id, tenantId: me.tenantId }, relations: { sites: true } });
    if (!user) throw new NotFoundException();
    if (id === me.id && (dto.active === false || (dto.role && dto.role !== Role.SUPER_ADMIN))) throw new ForbiddenException('CANNOT_DEMOTE_SELF');
    if (dto.active === true && !user.active) {
      const { maxUsers } = await this.limits(me.tenantId);
      if (maxUsers !== null && (await this.users.count({ where: { tenantId: me.tenantId, active: true } })) >= maxUsers) throw new ForbiddenException('PLAN_LIMIT_USERS');
    }
    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    const sameSites = (ids: string[]) => ids.length === user.sites.length && ids.every((sid) => user.sites.some((s) => s.id === sid));
    const privilegeChange = (dto.role !== undefined && dto.role !== user.role) || (dto.siteIds !== undefined && !sameSites([...new Set(dto.siteIds)])) || dto.active === false;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.siteIds !== undefined) user.sites = await this.tenantSites(me.tenantId, dto.siteIds);
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.ssoExempt !== undefined) user.ssoExempt = dto.ssoExempt;
    // While single sign-on is required, the last emergency administrator cannot go away.
    const losesEmergency = user.ssoExempt === false || user.active === false || user.role !== Role.SUPER_ADMIN;
    if (losesEmergency && (await this.tenants.exist({ where: { id: me.tenantId, ssoEnforced: true } })) && !(await this.hasEmergencyAdmin(me.tenantId, user.id))) {
      throw new ConflictException('SSO_EMERGENCY_ADMIN_REQUIRED');
    }
    if (privilegeChange) user.sessionVersion += 1; // force re-login with the new privileges
    await this.users.save(user);
    await this.audit.fromRequest(req, { action: 'USER_UPDATED', entityType: 'user', entityId: id, details: { ...dto } });
    return { ok: true };
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  async resetPassword(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @Req() req: AppRequest) {
    const user = await this.users.findOne({ where: { id, tenantId: me.tenantId } });
    if (!user) throw new NotFoundException();
    await this.users.update({ id, tenantId: me.tenantId }, {
      passwordHash: await this.crypto.hashPassword(dto.temporaryPassword), mustChangePassword: true,
      sessionVersion: user.sessionVersion + 1, failedLogins: 0, lockedUntil: null,
    });
    await this.audit.fromRequest(req, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: id });
    return { ok: true };
  }

  /** For a user who lost the phone and the recovery codes: they set it up again at the next login. */
  @Post('users/:id/reset-mfa')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  async resetMfa(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    if (id === me.id) throw new ForbiddenException('CANNOT_RESET_OWN_MFA');
    const user = await this.users.findOne({ where: { id, tenantId: me.tenantId } });
    if (!user) throw new NotFoundException();
    await this.users.update({ id, tenantId: me.tenantId }, {
      mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: null, sessionVersion: user.sessionVersion + 1,
    });
    await this.audit.fromRequest(req, { action: 'USER_MFA_RESET', entityType: 'user', entityId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------- policies
  @Get('policies')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR)
  listPolicies(@CurrentUser() user: AuthUser) {
    return this.policies.find({ where: { tenantId: user.tenantId }, order: { countryCode: 'ASC' } });
  }

  /** Adds a country: privacy-first defaults + first notice version from the template library. */
  @Post('policies')
  @Roles(Role.SUPER_ADMIN)
  async createPolicy(@CurrentUser() user: AuthUser, @Body() dto: CreatePolicyDto, @Req() req: AppRequest) {
    if (!dto.locales.includes(dto.defaultLocale)) throw new BadRequestException('DEFAULT_LOCALE_NOT_ENABLED');
    if (await this.policies.exist({ where: { tenantId: user.tenantId, countryCode: dto.countryCode } })) throw new ConflictException('COUNTRY_EXISTS');
    const policy = await this.policies.save(this.policies.create({ ...dto, tenantId: user.tenantId, documentDataEnabled: false, documentPhotoEnabled: false, assetPhotosRequired: false }));
    for (const locale of dto.locales as ('it' | 'es' | 'en')[]) {
      await this.notices.save(this.notices.create({ tenantId: user.tenantId, countryCode: dto.countryCode, locale, version: 1, createdBy: user.id, ...noticeTemplate(dto.countryCode, locale) }));
    }
    await this.audit.fromRequest(req, { action: 'POLICY_CREATED', entityType: 'country', entityId: dto.countryCode, details: { ...dto } });
    return policy;
  }

  @Patch('policies/:countryCode')
  @Roles(Role.SUPER_ADMIN)
  async updatePolicy(@CurrentUser() user: AuthUser, @Param('countryCode') cc: string, @Body() dto: UpdatePolicyDto, @Req() req: AppRequest) {
    const policy = await this.policies.findOne({ where: { tenantId: user.tenantId, countryCode: cc } });
    if (!policy) throw new NotFoundException();
    // Fields not sent arrive as undefined on the DTO instance: they must not overwrite stored values.
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as UpdatePolicyDto;
    const next = { ...policy, ...changes };
    if (next.documentDataEnabled) next.documentPhotoEnabled = true; // the document request always includes its photo
    if (!next.locales.includes(next.defaultLocale)) throw new BadRequestException('DEFAULT_LOCALE_NOT_ENABLED');
    await this.policies.save(next);
    await this.audit.fromRequest(req, { action: 'POLICY_UPDATED', entityType: 'country', entityId: cc, details: { before: { ...policy, updatedAt: undefined, id: undefined, tenantId: undefined }, after: dto } });
    return this.policies.findOneOrFail({ where: { tenantId: user.tenantId, countryCode: cc } });
  }

  @Get('notices')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR)
  listNotices(@CurrentUser() user: AuthUser, @Query('countryCode') cc?: string) {
    return this.notices.find({ where: { tenantId: user.tenantId, ...(cc ? { countryCode: cc } : {}) }, order: { countryCode: 'ASC', locale: 'ASC', version: 'DESC' } });
  }

  /** Notices are immutable: saving creates a new version, older acceptances keep their exact text. */
  @Post('notices')
  @Roles(Role.SUPER_ADMIN)
  async createNotice(@CurrentUser() user: AuthUser, @Body() dto: CreateNoticeDto, @Req() req: AppRequest) {
    if (!(await this.policies.exist({ where: { tenantId: user.tenantId, countryCode: dto.countryCode } }))) throw new BadRequestException('UNKNOWN_COUNTRY');
    const last = await this.notices.findOne({ where: { tenantId: user.tenantId, countryCode: dto.countryCode, locale: dto.locale }, order: { version: 'DESC' } });
    const notice = await this.notices.save(this.notices.create({ ...dto, tenantId: user.tenantId, version: (last?.version ?? 0) + 1, createdBy: user.id }));
    await this.audit.fromRequest(req, { action: 'NOTICE_PUBLISHED', entityType: 'notice', entityId: notice.id, details: { countryCode: dto.countryCode, locale: dto.locale, version: notice.version } });
    return notice;
  }

  // ---------------------------------------------------------------- audit
  @Get('audit')
  @Roles(Role.SUPER_ADMIN, Role.AUDITOR)
  async listAudit(@CurrentUser() user: AuthUser, @Query() q: AuditQueryDto, @Req() req: AppRequest) {
    const page = q.page ?? 1;
    const [items, total] = await this.auditLogs.findAndCount({ where: this.auditWhere(user, q), order: { at: 'DESC', id: 'DESC' }, skip: (page - 1) * 100, take: 100 });
    await this.audit.fromRequest(req, { action: 'AUDIT_VIEW', details: { ...q } });
    return { items, total, page, pageSize: 100 };
  }

  private auditWhere(user: AuthUser, q: AuditExportQueryDto) {
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (q.from && q.to) where.at = Between(new Date(q.from), new Date(q.to));
    else if (q.from) where.at = MoreThanOrEqual(new Date(q.from));
    else if (q.to) where.at = LessThan(new Date(q.to));
    if (q.action) where.action = q.action;
    if (q.actor) where.actorLabel = Like(`%${q.actor.replace(/[%_\\]/g, '')}%`);
    if (q.entityId) where.entityId = q.entityId;
    return where;
  }

  @Get('audit/export.csv')
  @Roles(Role.SUPER_ADMIN, Role.AUDITOR)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportAudit(@CurrentUser() user: AuthUser, @Query() q: AuditExportQueryDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const items = await this.auditLogs.find({ where: this.auditWhere(user, q), order: { at: 'ASC', id: 'ASC' }, take: 50_001 });
    if (items.length > 50_000) throw new BadRequestException('EXPORT_TOO_LARGE');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    const header = ['at_utc', 'actor_type', 'actor', 'action', 'entity_type', 'entity_id', 'site_id', 'ip', 'details'];
    const lines = items.map((r) => [r.at, r.actorType, r.actorLabel, r.action, r.entityType, r.entityId, r.siteId, r.ip, r.details ? JSON.stringify(r.details) : null].map(csvCell).join(','));
    await this.audit.fromRequest(req, { action: 'AUDIT_EXPORT', details: { ...q, rows: items.length } });
    return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
  }
}
