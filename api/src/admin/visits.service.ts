import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { TenantCrypto } from '../common/crypto.service';
import { FilesService } from '../common/files.service';
import { assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { addDays } from '../common/time.util';
import { VisitLifecycleService } from '../common/visit-lifecycle.service';
import { Role, Site, StoredFile, Visit, VisitStatus } from '../entities';
import { EraseVisitDto, VisitQueryDto } from './admin.dto';
import { csvCell } from './csv';

const RECEPTIONIST_WINDOW_DAYS = 7;
const PAGE_SIZE = 50;

@Injectable()
export class VisitsService {
  constructor(
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(StoredFile) private readonly storedFiles: Repository<StoredFile>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly keys: TenantKeysService,
    private readonly files: FilesService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly audit: AuditService,
  ) {}

  /** Every query starts from the caller's tenant; site and time scoping follow the role. */
  private scoped(user: AuthUser, tc: TenantCrypto, q: VisitQueryDto): SelectQueryBuilder<Visit> {
    const qb = this.visits.createQueryBuilder('v').leftJoinAndSelect('v.site', 's').where('v.tenantId = :tid', { tid: user.tenantId });
    if (q.siteId) { assertSiteAccess(user, q.siteId); qb.andWhere('v.siteId = :siteId', { siteId: q.siteId }); }
    else {
      const ids = visibleSiteIds(user);
      if (ids) qb.andWhere(ids.length ? 'v.siteId IN (:...ids)' : '1=0', { ids });
    }
    let from = q.from ? new Date(q.from) : undefined;
    if (user.role === Role.RECEPTIONIST) {
      const min = addDays(new Date(), -RECEPTIONIST_WINDOW_DAYS);
      if (!from || from < min) from = min;
    }
    if (from) qb.andWhere('v.checkInAt >= :from', { from });
    if (q.to) qb.andWhere('v.checkInAt < :to', { to: new Date(q.to) });
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.q) {
      const term = q.q.trim();
      if (term.includes('@')) qb.andWhere('v.emailIndex = :h', { h: tc.blindIndex(term, 'visit.email') });
      else if (/^[A-Z0-9]{5}$/.test(term)) qb.andWhere('(v.code = :code OR v.lastNameIndex = :h)', { code: term, h: tc.blindIndex(term, 'visit.lastName') });
      else qb.andWhere('v.lastNameIndex = :h', { h: tc.blindIndex(term, 'visit.lastName') });
    }
    return qb;
  }

  private row(tc: TenantCrypto, v: Visit) {
    return {
      id: v.id, code: v.code, status: v.status, siteId: v.siteId, siteName: v.site?.name ?? null, siteTimezone: v.site?.timezone ?? null,
      checkInAt: v.checkInAt, checkOutAt: v.checkOutAt, purpose: v.purpose, travelDistance: v.travelDistance,
      firstName: tc.decrypt(v.firstNameEnc, 'visit.firstName'), lastName: tc.decrypt(v.lastNameEnc, 'visit.lastName'),
      company: tc.decrypt(v.companyEnc, 'visit.company'), host: tc.decrypt(v.hostEnc, 'visit.host'), anonymized: !!v.anonymizedAt,
    };
  }

  private safeFilters(q: VisitQueryDto) { return { ...q, q: q.q ? '[search]' : undefined }; }

  async list(user: AuthUser, q: VisitQueryDto, req: AppRequest) {
    const tc = await this.keys.forTenant(user.tenantId);
    const page = Math.max(1, q.page ?? 1);
    const [items, total] = await this.scoped(user, tc, q).orderBy('v.checkInAt', 'DESC').skip((page - 1) * PAGE_SIZE).take(PAGE_SIZE).getManyAndCount();
    await this.audit.fromRequest(req, { action: 'VISIT_LIST', siteId: q.siteId ?? null, details: { filters: this.safeFilters(q), returned: items.length } });
    return { items: items.map((v) => this.row(tc, v)), total, page, pageSize: PAGE_SIZE };
  }

  /** People currently on site: the evacuation / emergency list. */
  async present(user: AuthUser, siteId: string, req: AppRequest) {
    assertSiteAccess(user, siteId);
    if (!(await this.sites.exist({ where: { id: siteId, tenantId: user.tenantId } }))) throw new NotFoundException();
    const tc = await this.keys.forTenant(user.tenantId);
    const items = await this.visits.find({ where: { tenantId: user.tenantId, siteId, status: VisitStatus.OPEN }, relations: { site: true }, order: { checkInAt: 'ASC' } });
    await this.audit.fromRequest(req, { action: 'PRESENT_LIST', siteId, details: { returned: items.length } });
    return items.map((v) => this.row(tc, v));
  }

  private async load(user: AuthUser, id: string): Promise<Visit> {
    const v = await this.visits.findOne({ where: { id, tenantId: user.tenantId }, relations: { site: true, files: true } });
    if (!v) throw new NotFoundException();
    assertSiteAccess(user, v.siteId);
    if (user.role === Role.RECEPTIONIST && v.checkInAt < addDays(new Date(), -RECEPTIONIST_WINDOW_DAYS)) throw new ForbiddenException();
    return v;
  }

  async detail(user: AuthUser, id: string, req: AppRequest) {
    const v = await this.load(user, id);
    const tc = await this.keys.forTenant(user.tenantId);
    const canSeeSensitive = user.role !== Role.RECEPTIONIST;
    const docNumber = tc.decrypt(v.documentNumberEnc, 'visit.documentNumber');
    await this.audit.fromRequest(req, { action: 'VISIT_VIEW', entityType: 'visit', entityId: v.id, siteId: v.siteId });
    return {
      ...this.row(tc, v),
      email: tc.decrypt(v.emailEnc, 'visit.email'),
      documentType: v.documentType,
      documentNumber: docNumber ? (canSeeSensitive ? docNumber : `•••${docNumber.slice(-3)}`) : null,
      checkOutBy: v.checkOutBy, locale: v.locale, privacyNoticeVersion: v.privacyNoticeVersion, privacyAcceptedAt: v.privacyAcceptedAt,
      noticeEmailStatus: v.noticeEmailStatus, badgeEmailStatus: v.badgeEmailStatus, hostEmailStatus: v.hostEmailStatus, anonymizedAt: v.anonymizedAt,
      files: (v.files ?? []).map((f) => ({ id: f.id, kind: f.kind, available: !f.purgedAt, purgeAfter: f.purgeAfter, viewable: canSeeSensitive && !f.purgedAt })),
    };
  }

  async file(user: AuthUser, visitId: string, fileId: string, req: AppRequest) {
    const v = await this.load(user, visitId);
    const f = await this.storedFiles.findOne({ where: { id: fileId, visitId: v.id, tenantId: user.tenantId } });
    if (!f) throw new NotFoundException();
    const data = await this.files.read(await this.keys.forTenant(user.tenantId), f);
    await this.audit.fromRequest(req, { action: 'FILE_VIEW', entityType: 'file', entityId: f.id, siteId: v.siteId, details: { visitId: v.id, kind: f.kind } });
    return { mime: f.mime, data };
  }

  async manualCheckout(user: AuthUser, id: string, req: AppRequest) {
    const v = await this.load(user, id);
    const res = await this.visits.update({ id: v.id, tenantId: user.tenantId, status: VisitStatus.OPEN }, { status: VisitStatus.CLOSED, checkOutAt: new Date(), checkOutBy: `user:${user.email}`.slice(0, 80) });
    if (!res.affected) throw new ConflictException('VISIT_ALREADY_CLOSED');
    await this.audit.fromRequest(req, { action: 'VISIT_CHECK_OUT_MANUAL', entityType: 'visit', entityId: v.id, siteId: v.siteId });
    return { ok: true };
  }

  /** Right to erasure (GDPR art. 17 and equivalent LatAm rights). */
  async erase(user: AuthUser, id: string, dto: EraseVisitDto, req: AppRequest) {
    const v = await this.load(user, id);
    if (v.status === VisitStatus.ERASED) throw new ConflictException('ALREADY_ERASED');
    await this.lifecycle.anonymize(user.tenantId, v.id, { erased: true });
    await this.audit.fromRequest(req, { action: 'VISIT_ERASED', entityType: 'visit', entityId: v.id, siteId: v.siteId, details: { reason: dto.reason, ticket: dto.ticket ?? null } });
    return { ok: true };
  }

  async exportCsv(user: AuthUser, q: VisitQueryDto, req: AppRequest): Promise<string> {
    const tc = await this.keys.forTenant(user.tenantId);
    const items = await this.scoped(user, tc, q).orderBy('v.checkInAt', 'ASC').take(10_001).getMany();
    if (items.length > 10_000) throw new BadRequestException('EXPORT_TOO_LARGE');
    const header = ['code', 'site', 'status', 'check_in_utc', 'check_out_utc', 'first_name', 'last_name', 'company', 'host', 'purpose', 'travel_distance'];
    const lines = items.map((v) => this.row(tc, v)).map((r) => [r.code, r.siteName, r.status, r.checkInAt, r.checkOutAt, r.firstName, r.lastName, r.company, r.host, r.purpose, r.travelDistance].map(csvCell).join(','));
    await this.audit.fromRequest(req, { action: 'VISIT_EXPORT', siteId: q.siteId ?? null, details: { filters: this.safeFilters(q), rows: items.length } });
    return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
  }
}
