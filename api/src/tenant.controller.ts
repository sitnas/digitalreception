import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentTenant } from './common/guards';
import { AuthTenant } from './common/request-context';
import { Tenant } from './entities';

/** Public branding of the tenant resolved from the host (login page, tablet header). */
@Controller('tenant')
export class TenantController {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  @Get()
  async branding(@CurrentTenant() tenant: AuthTenant) {
    const t = await this.tenants.findOneOrFail({ where: { id: tenant.id }, select: { id: true, name: true, logoDataUrl: true } });
    return { name: t.name, logo: t.logoDataUrl };
  }
}
