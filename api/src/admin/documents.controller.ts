import { RequireApp } from '../common/apps';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role, Site, SiteDocument, SiteDocumentVersion, VisitDocument } from '../entities';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDocumentDto {
  @Transform(trim) @IsString() @Length(2, 120) name: string;
  /** null = every site. */
  @ValidateIf((_, v) => v !== null) @IsUUID() siteId: string | null;
}
export class UpdateDocumentDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() siteId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
}
export class DocumentVersionDto {
  @IsIn(['it', 'es', 'en']) locale: string;
  @Transform(trim) @IsString() @Length(3, 200) title: string;
  @IsString() @Length(20, 30_000) body: string;
}

/**
 * Documents guests accept at check-in besides the privacy notice (safety rules, NDA).
 * Texts are immutable: saving publishes a new version, and each visit keeps the version it accepted.
 */
@Controller('admin/documents')
@RequireApp('reception')
@UseGuards(AdminAuthGuard)
export class DocumentsController {
  constructor(
    @InjectRepository(SiteDocument) private readonly docs: Repository<SiteDocument>,
    @InjectRepository(SiteDocumentVersion) private readonly versions: Repository<SiteDocumentVersion>,
    @InjectRepository(VisitDocument) private readonly accepted: Repository<VisitDocument>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly audit: AuditService,
  ) {}

  private async checkSite(tenantId: string, siteId: string | null | undefined) {
    if (siteId && !(await this.sites.exist({ where: { id: siteId, tenantId } }))) throw new BadRequestException('SITE_NOT_FOUND');
  }
  private async load(tenantId: string, id: string) {
    const d = await this.docs.findOne({ where: { id, tenantId } });
    if (!d) throw new NotFoundException();
    return d;
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR)
  async list(@CurrentUser() user: AuthUser) {
    const docs = await this.docs.find({ where: { tenantId: user.tenantId }, order: { active: 'DESC', position: 'ASC', createdAt: 'ASC' } });
    const versions = docs.length ? await this.versions.find({ where: { tenantId: user.tenantId, documentId: In(docs.map((d) => d.id)) }, order: { version: 'DESC' } }) : [];
    const counts = docs.length ? await this.accepted.createQueryBuilder('a').select('a.documentId', 'documentId').addSelect('COUNT(*)', 'n')
      .where('a.tenantId = :t', { t: user.tenantId }).groupBy('a.documentId').getRawMany<{ documentId: string; n: string }>() : [];
    return docs.map((d) => {
      const latest: Record<string, SiteDocumentVersion> = {};
      for (const v of versions) if (v.documentId === d.id && !latest[v.locale]) latest[v.locale] = v;
      return { ...d, texts: latest, acceptances: Number(counts.find((c) => c.documentId === d.id)?.n ?? 0) };
    });
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto, @Req() req: AppRequest) {
    await this.checkSite(user.tenantId, dto.siteId);
    const position = await this.docs.count({ where: { tenantId: user.tenantId } });
    const d = await this.docs.save(this.docs.create({ tenantId: user.tenantId, name: dto.name, siteId: dto.siteId ?? null, active: true, position }));
    await this.audit.fromRequest(req, { action: 'DOCUMENT_CREATED', entityType: 'document', entityId: d.id, siteId: d.siteId, details: { name: d.name } });
    return d;
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto, @Req() req: AppRequest) {
    const d = await this.load(user.tenantId, id);
    if (dto.siteId !== undefined) await this.checkSite(user.tenantId, dto.siteId);
    const before = { name: d.name, siteId: d.siteId, active: d.active, position: d.position };
    Object.assign(d, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await this.docs.save(d);
    await this.audit.fromRequest(req, { action: 'DOCUMENT_UPDATED', entityType: 'document', entityId: d.id, siteId: d.siteId, details: { before, after: dto } });
    return d;
  }

  /** Publishes a new text in one language. Guests in the middle of a check-in are asked to read it again. */
  @Post(':id/versions')
  @Roles(Role.SUPER_ADMIN)
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocumentVersionDto, @Req() req: AppRequest) {
    const d = await this.load(user.tenantId, id);
    const last = await this.versions.findOne({ where: { documentId: d.id, locale: dto.locale }, order: { version: 'DESC' } });
    const v = await this.versions.save(this.versions.create({ tenantId: user.tenantId, documentId: d.id, locale: dto.locale, version: (last?.version ?? 0) + 1, title: dto.title, body: dto.body, createdBy: user.id }));
    await this.audit.fromRequest(req, { action: 'DOCUMENT_PUBLISHED', entityType: 'document', entityId: d.id, siteId: d.siteId, details: { locale: v.locale, version: v.version } });
    return v;
  }
}
