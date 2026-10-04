import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DbThrottlerStorage } from './common/db-throttler.storage';
import { ManagementController } from './admin/management.controller';
import { StatsController } from './admin/stats.controller';
import { InvitationsController } from './invitations/invitations.controller';
import { AccessAdminController } from './access/access-admin.controller';
import { ApiKeyGuard, EmployeeAppGuard, ReaderGuard } from './access/access.guards';
import { EmployeeAppController } from './access/employee-app.controller';
import { AccessService } from './access/access.service';
import { IntegrationController } from './access/integration.controller';
import { BadgeController, ReaderController } from './access/reader.controller';
import { InvitationsService } from './invitations/invitations.service';
import { VisitsController } from './admin/visits.controller';
import { PushSettingsController, WebhooksController } from './admin/webhooks.controller';
import { EvacuationsController } from './admin/evacuations.controller';
import { DocumentsController } from './admin/documents.controller';
import { GuestController } from './invitations/guest.controller';
import { SiteDocumentsService } from './common/site-documents.service';
import { WebhooksService } from './common/webhooks.service';
import { WebhookOutboxService } from './retention/webhook-outbox.service';
import { PushOutboxService } from './retention/push-outbox.service';
import { PushService } from './common/push.service';
import { VisitsService } from './admin/visits.service';
import { AuthController } from './auth/auth.controller';
import { SessionService } from './auth/session.service';
import { SsoController } from './auth/sso.controller';
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
    ThrottlerModule.forRootAsync({
      inject: [DataSource],
      // With several replicas the counters must be shared, or each one grants its own quota.
      useFactory: (ds: DataSource) => ({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }], ...(config.throttleStore === 'database' ? { storage: new DbThrottlerStorage(ds) } : {}) }),
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, TenantController, AuthController, SsoController, KioskController, VisitsController, ManagementController, StatsController, InvitationsController, IntegrationController, ReaderController, BadgeController, AccessAdminController, EmployeeAppController, WebhooksController, PushSettingsController, EvacuationsController, DocumentsController, GuestController],
  providers: [
    { provide: APP_CONFIG, useValue: config as AppConfig },
    { provide: STORAGE, useFactory: () => createStorage(config) },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CryptoService, TenantKeysService, InvitationsService, AccessService, ApiKeyGuard, ReaderGuard, EmployeeAppGuard, AuditService, FilesService, MailService, VisitLifecycleService,
    SessionService, AdminAuthGuard, DeviceGuard, KioskService, VisitsService, RetentionService, MailOutboxService, WebhooksService, WebhookOutboxService, PushService, PushOutboxService, SiteDocumentsService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route except health checks requires a resolved, active tenant.
    consumer.apply(TenantResolverMiddleware)
      // The single sign-on callback is shared by every organisation: the request it answers says which one.
      .exclude({ path: 'health', method: RequestMethod.ALL }, { path: 'health/(.*)', method: RequestMethod.ALL }, { path: 'auth/sso/callback', method: RequestMethod.GET })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
