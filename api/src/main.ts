import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './common/app-config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['log', 'warn', 'error'] });
  const cfg = app.get<AppConfig>(APP_CONFIG);

  app.set('trust proxy', cfg.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store'); // personal data must never sit in browser or proxy caches
    next();
  });
  app.use(json({ limit: '12mb' })); // three compressed photos + signature, validated again per field
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  // Same-origin deployment (web + api behind one host): CORS stays disabled on purpose.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }));
  app.enableShutdownHooks();

  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${cfg.port} (${cfg.env})`);
}
bootstrap();
