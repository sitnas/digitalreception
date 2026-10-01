import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { WebhooksService } from '../common/webhooks.service';
import { Role, Site, Webhook, WEBHOOK_EVENTS, type WebhookEvent, type WebhookKind } from '../entities';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const KINDS: WebhookKind[] = ['teams', 'slack', 'generic'];

export class CreateWebhookDto {
  @Transform(trim) @IsString() @Length(2, 80) name: string;
  @IsIn(KINDS) kind: WebhookKind;
  @Transform(trim) @IsString() @MaxLength(2000) url: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsIn(WEBHOOK_EVENTS, { each: true }) events: WebhookEvent[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() siteId?: string | null;
  @IsOptional() @IsBoolean() includeNames?: boolean;
}
export class UpdateWebhookDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: WebhookEvent[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() siteId?: string | null;
  @IsOptional() @IsBoolean() includeNames?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Notifications to Teams, Slack or another system. The address is never returned: it holds a secret. */
@Controller('admin/webhooks')
@UseGuards(AdminAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class WebhooksController {
  constructor(
    @InjectRepository(Webhook) private readonly hooks: Repository<Webhook>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly webhooks: WebhooksService,
    private readonly keys: TenantKeysService,
    private readonly audit: AuditService,
  ) {}

  private view(h: Webhook) {
    return { id: h.id, name: h.name, kind: h.kind, urlHost: h.urlHost, events: h.events.split(','), siteId: h.siteId, includeNames: h.includeNames, active: h.active, lastResult: h.lastResult, lastAt: h.lastAt, createdAt: h.createdAt };
  }

  private async own(user: AuthUser, id: string) {
    const h = await this.hooks.findOne({ where: { id, tenantId: user.tenantId } });
    if (!h) throw new NotFoundException();
    return h;
  }

  private async checkSite(user: AuthUser, siteId?: string | null) {
    if (siteId && !(await this.sites.exist({ where: { id: siteId, tenantId: user.tenantId } }))) throw new BadRequestException('UNKNOWN_SITE');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return (await this.hooks.find({ where: { tenantId: user.tenantId }, order: { createdAt: 'ASC' } })).map((h) => this.view(h));
  }

  /** For the generic kind the signing secret is returned once, here. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWebhookDto, @Req() req: AppRequest) {
    const url = this.webhooks.checkUrl(dto.url);
    await this.checkSite(user, dto.siteId);
    const tc = await this.keys.forTenant(user.tenantId);
    const secret = dto.kind === 'generic' ? `whsec_${randomBytes(24).toString('base64url')}` : null;
    const h = await this.hooks.save(this.hooks.create({
      tenantId: user.tenantId, name: dto.name, kind: dto.kind, urlEnc: tc.encrypt(url.href, 'webhook.url')!, urlHost: url.host,
      events: [...new Set(dto.events)].join(','), siteId: dto.siteId ?? null, includeNames: dto.includeNames ?? false,
      secretEnc: tc.encrypt(secret, 'webhook.secret'), active: true, lastResult: null, lastAt: null,
    }));
    await this.audit.fromRequest(req, { action: 'WEBHOOK_CREATED', entityType: 'webhook', entityId: h.id, details: { kind: h.kind, host: h.urlHost, events: h.events, includeNames: h.includeNames } });
    return { ...this.view(h), secret };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookDto, @Req() req: AppRequest) {
    const h = await this.own(user, id);
    if (dto.siteId !== undefined) await this.checkSite(user, dto.siteId);
    if (dto.url !== undefined) {
      const url = this.webhooks.checkUrl(dto.url);
      h.urlEnc = (await this.keys.forTenant(user.tenantId)).encrypt(url.href, 'webhook.url')!;
      h.urlHost = url.host;
    }
    if (dto.name !== undefined) h.name = dto.name;
    if (dto.events !== undefined) h.events = [...new Set(dto.events)].join(',');
    if (dto.siteId !== undefined) h.siteId = dto.siteId;
    if (dto.includeNames !== undefined) h.includeNames = dto.includeNames;
    if (dto.active !== undefined) h.active = dto.active;
    await this.hooks.save(h);
    await this.audit.fromRequest(req, { action: 'WEBHOOK_UPDATED', entityType: 'webhook', entityId: id, details: { ...dto, url: dto.url !== undefined ? h.urlHost : undefined } });
    return this.view(h);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const h = await this.own(user, id);
    await this.hooks.delete({ id: h.id, tenantId: user.tenantId });
    await this.audit.fromRequest(req, { action: 'WEBHOOK_DELETED', entityType: 'webhook', entityId: id, details: { host: h.urlHost } });
    return { ok: true };
  }

  /** Sends a test message right away and says how it went (OK, HTTP_404, TIMEOUT…). */
  @Post(':id/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async test(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const h = await this.own(user, id);
    const lang = String(req.headers['accept-language'] ?? '').slice(0, 2);
    const result = await this.webhooks.test(h, ['it', 'es', 'en'].includes(lang) ? lang : 'it');
    await this.audit.fromRequest(req, { action: 'WEBHOOK_TESTED', entityType: 'webhook', entityId: id, details: { result } });
    return { result };
  }
}
