import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MailOutboxService } from '../retention/mail-outbox.service';
import { RetentionService } from '../retention/retention.service';

/** Manual trigger of the background jobs (the API also runs them on schedule, one replica at a time). */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  await app.get(RetentionService).run();
  await app.get(MailOutboxService).run();
  await app.close();
}
main();
