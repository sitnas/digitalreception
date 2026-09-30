import { Controller, Get, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from './common/app-config';
import { CurrentTenant } from './common/guards';
import { AuthTenant } from './common/request-context';
import { Tenant } from './entities';

/** Public branding of the tenant resolved from the host (login page, tablet header). */
@Controller('tenant')
export class TenantController {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Get()
  async branding(@CurrentTenant() tenant: AuthTenant) {
    const t = await this.tenants.findOneOrFail({ where: { id: tenant.id }, select: { id: true, name: true, logoDataUrl: true, primaryColor: true, secondaryColor: true, ssoProvider: true, ssoOrgId: true, ssoEnforced: true } });
    // The login page offers single sign-on only when the directory is linked and the platform has the app.
    const sso = t.ssoProvider && t.ssoOrgId && this.cfg.sso.providers[t.ssoProvider] ? { provider: t.ssoProvider, enforced: t.ssoEnforced } : null;
    return { name: t.name, logo: t.logoDataUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, sso };
  }
}
