import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { Repository } from 'typeorm';
import { APP_KEYS, type AppKey } from '../common/apps';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role, Tenant } from '../entities';

export class AppsDto {
  @IsArray() @ArrayUnique() @IsIn(APP_KEYS, { each: true }) apps: AppKey[];
}

/** Apps of the portal turned on for the organisation. Turning one off hides it everywhere and keeps its data. */
@Controller('admin/apps')
@UseGuards(AdminAuthGuard)
export class AppsController {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, private readonly audit: AuditService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const t = await this.tenants.findOneOrFail({ where: { id: user.tenantId }, select: { id: true, apps: true } });
    return { apps: t.apps, available: APP_KEYS };
  }

  @Put()
  @Roles(Role.SUPER_ADMIN)
  async update(@CurrentUser() user: AuthUser, @Body() dto: AppsDto, @Req() req: AppRequest) {
    // Kept in a fixed order, so the list reads the same everywhere.
    const apps = APP_KEYS.filter((a) => dto.apps.includes(a));
    const before = (await this.tenants.findOneOrFail({ where: { id: user.tenantId }, select: { id: true, apps: true } })).apps;
    await this.tenants.update(user.tenantId, { apps });
    await this.audit.fromRequest(req, { action: 'APPS_UPDATED', details: { before, after: apps } });
    return { apps };
  }
}
