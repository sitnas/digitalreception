import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../common/app-config';
import { ENTITIES } from '../entities';

export function typeormOptions(cfg: AppConfig): DataSourceOptions {
  return {
    type: cfg.db.type,
    host: cfg.db.host,
    port: cfg.db.port,
    username: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.name,
    entities: ENTITIES,
    migrations: [__dirname + '/migrations/*.js'],
    migrationsRun: !cfg.db.synchronize,
    synchronize: cfg.db.synchronize,
    timezone: 'Z',          // every timestamp stored in UTC
    charset: 'utf8mb4_unicode_ci',
    extra: { connectionLimit: cfg.db.poolSize },
    logging: ['migration'], // queries are never logged, not even failed ones
  };
}
