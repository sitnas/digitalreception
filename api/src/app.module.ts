import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagementController } from './admin/management.controller';
import { StatsController } from './admin/stats.controller';
import { VisitsController } from './admin/visits.controller';
import { VisitsService } from './admin/visits.service';
import { AuthController } from './auth/auth.controller';
import { APP_CONFIG, AppConfig, loadConfig } from './common/app-config';
import { AuditService } from './common/audit.service';
import { CryptoService } from './common/crypto.service';
import { FilesService } from './common/files.service';
import { AdminAuthGuard, DeviceGuard } from './common/guards';
import { MailService } from './common/mail.service';
import { STORAGE, createStorage } from './common/storage';
import { TenantKeysService } from './common/tenant-keys.service';
import { TenantResolverMiddleware } from './common/tenant-resolver.middleware';
import { VisitLifecycleService } from './common/visit-lifecycle.service';
import { typeormOptions } from './database/typeorm-options';
import { ENTITIES } from './entities';
import { HealthController } from './health.controller';
import { KioskController } from './kiosk/kiosk.controller';
import { KioskService } from './kiosk/kiosk.service';
import { MailOutboxService } from './retention/mail-outbox.service';
import { RetentionService } from './retention/retention.service';
import { TenantController } from './tenant.controller';

const config = loadConfig();
const JWT = { algorithm: 'HS256' as const, issuer: 'reception-api', audience: 'reception-admin' };

@Module({
  imports: [
    TypeOrmModule.forRoot(typeormOptions(config)),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.register({ secret: config.auth.jwtSecret, signOptions: JWT, verifyOptions: { algorithms: [JWT.algorithm], issuer: JWT.issuer, audience: JWT.audience } }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, TenantController, AuthController, KioskController, VisitsController, ManagementController, StatsController],
  providers: [
    { provide: APP_CONFIG, useValue: config as AppConfig },
    { provide: STORAGE, useFactory: () => createStorage(config) },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CryptoService, TenantKeysService, AuditService, FilesService, MailService, VisitLifecycleService,
    AdminAuthGuard, DeviceGuard, KioskService, VisitsService, RetentionService, MailOutboxService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route except health checks requires a resolved, active tenant.
    consumer.apply(TenantResolverMiddleware)
      .exclude({ path: 'health', method: RequestMethod.ALL }, { path: 'health/(.*)', method: RequestMethod.ALL })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
