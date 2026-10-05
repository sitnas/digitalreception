import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_KEYS, employeeApps } from '../common/apps';
import { AdminAuthGuard, CurrentUser } from '../common/guards';
import { AuthUser } from '../common/request-context';
import { Employee, Tenant } from '../entities';

/**
 * The apps the organisation has. They are turned on by the platform operator (`npm run tenant -- apps`),
 * not from the console; the organisation then decides who uses them, in each employee's card.
 */
@Controller('admin/apps')
@UseGuards(AdminAuthGuard)
export class AppsController {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, @InjectRepository(Employee) private readonly employees: Repository<Employee>) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const t = await this.tenants.findOneOrFail({ where: { id: user.tenantId }, select: { id: true, apps: true } });
    const people = await this.employees.find({ where: { tenantId: user.tenantId, active: true }, select: { id: true, appsOff: true, parkingRole: true } });
    // How many active employees see each app on the phone.
    const using = Object.fromEntries(t.apps.map((a) => [a, people.filter((e) => employeeApps(t.apps, e.appsOff, e.parkingRole).includes(a)).length]));
    return { apps: t.apps, available: APP_KEYS, employees: people.length, using };
  }
}
