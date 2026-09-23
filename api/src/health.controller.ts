import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** For load balancers / orchestrators. Outside tenant resolution on purpose. */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Liveness: the process answers. */
  @Get('live')
  live() { return { status: 'ok' }; }

  /** Readiness: the process can serve traffic (database reachable). */
  @Get()
  async ready() {
    await this.ds.query('SELECT 1');
    return { status: 'ok' };
  }
}
