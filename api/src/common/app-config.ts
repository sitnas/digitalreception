/**
 * Centralised, validated configuration (12-factor: everything comes from the environment).
 * The process refuses to start if a security-relevant variable is missing or malformed.
 */
export type TenancyMode = 'single' | 'subdomain';

export interface AppConfig {
  env: 'production' | 'development' | 'test';
  port: number;
  trustProxy: number;
  tenancy: { mode: TenancyMode; baseDomain?: string; defaultSlug?: string };
  db: { type: 'mysql' | 'mariadb'; host: string; port: number; user: string; password: string; name: string; synchronize: boolean; poolSize: number };
  /** Master key-encryption keys (KEK). They never touch data directly: they only wrap each tenant's own keys. */
  masterKeys: { keys: Map<string, Buffer>; activeKeyId: string };
  auth: { jwtSecret: string; sessionHours: number; cookieSecure: boolean; maxFailedLogins: number; lockMinutes: number };
  storage:
    | { driver: 'local'; dir: string }
    | { driver: 's3'; bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean; prefix: string };
  access: { logRetentionDays: number };
  /** Console audit trail (who did what, with IP): kept this many days, then deleted. */
  audit: { retentionDays: number };
  /** Outgoing notifications. allowPrivate (tests and development only) lets them reach local addresses over http. */
  webhooks: { allowPrivate: boolean };
  mail: { host?: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
  jobs: { enabled: boolean };
  /** Sign-in with Microsoft / Google (OIDC). Apps registered once by the platform; each organisation links its own directory. */
  sso: { redirectUri?: string; providers: Partial<Record<SsoProviderId, SsoProviderConfig>> };
}

export type SsoProviderId = 'microsoft' | 'google';
/** `issuer` is the Microsoft authority (…/<tenant>/v2.0 is appended) or the Google issuer. Overridable for tests. */
export interface SsoProviderConfig { clientId: string; clientSecret: string; issuer: string }

export const APP_CONFIG = Symbol('APP_CONFIG');

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required environment variable ${name}`);
  return v.trim();
}

export function parseKeyring(name: string, raw: string): { keys: Map<string, Buffer>; activeKeyId: string } {
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',')) {
    const [kid, b64] = entry.trim().split(':');
    if (!kid || !b64 || !/^[a-z0-9]{1,8}$/i.test(kid)) throw new Error(`${name} malformed, expected "k1:<base64>,k2:<base64>"`);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 32) throw new Error(`${name}[${kid}] must be 32 bytes base64-encoded`);
    keys.set(kid, buf);
  }
  // The LAST key wraps new tenant keys; older ones only unwrap existing ones (rotation).
  return { keys, activeKeyId: [...keys.keys()].pop()! };
}

export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV ?? 'production') as AppConfig['env'];
  const jwtSecret = req('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const mode = (process.env.TENANCY_MODE ?? 'single') as TenancyMode;
  if (!['single', 'subdomain'].includes(mode)) throw new Error('TENANCY_MODE must be "single" or "subdomain"');

  const driver = process.env.STORAGE_DRIVER ?? 'local';
  const storage: AppConfig['storage'] = driver === 's3'
    ? {
        driver: 's3', bucket: req('S3_BUCKET'), region: process.env.S3_REGION ?? 'us-east-1', endpoint: process.env.S3_ENDPOINT || undefined,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', prefix: process.env.S3_PREFIX ?? '',
      }
    : { driver: 'local', dir: process.env.FILES_DIR ?? '/data/files' };

  const cfg: AppConfig = {
    env,
    port: Number(process.env.PORT ?? 3000),
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    tenancy: {
      mode,
      baseDomain: mode === 'subdomain' ? req('BASE_DOMAIN').toLowerCase() : undefined,
      defaultSlug: mode === 'single' ? req('DEFAULT_TENANT_SLUG') : process.env.DEFAULT_TENANT_SLUG || undefined,
    },
    db: {
      type: (process.env.DB_TYPE as 'mysql' | 'mariadb') ?? 'mysql',
      host: req('DB_HOST'),
      port: Number(process.env.DB_PORT ?? 3306),
      user: req('DB_USER'),
      password: req('DB_PASSWORD'),
      name: req('DB_NAME'),
      synchronize: process.env.DB_SYNC === 'true',
      poolSize: Number(process.env.DB_POOL_SIZE ?? 10),
    },
    masterKeys: parseKeyring('MASTER_KEYS', req('MASTER_KEYS')),
    auth: {
      jwtSecret,
      sessionHours: Number(process.env.SESSION_HOURS ?? 8),
      cookieSecure: process.env.COOKIE_SECURE !== 'false',
      maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS ?? 5),
      lockMinutes: Number(process.env.LOCK_MINUTES ?? 15),
    },
    storage,
    // Employee access log: kept short on purpose (worker monitoring rules, GDPR minimisation).
    access: { logRetentionDays: Math.max(1, Number(process.env.ACCESS_LOG_RETENTION_DAYS ?? 90)) },
    // Long enough to investigate an incident or answer an audit, not forever (it holds IPs and emails).
    webhooks: { allowPrivate: process.env.WEBHOOK_ALLOW_PRIVATE === 'true' },
    audit: { retentionDays: Math.max(90, Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 365)) },
    mail: {
      host: process.env.SMTP_HOST || undefined,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || undefined,
      pass: process.env.SMTP_PASS || undefined,
      from: process.env.MAIL_FROM ?? 'reception@example.invalid',
    },
    // Every replica may run jobs: a DB lock guarantees a single executor. Set JOBS_ENABLED=false to keep a replica API-only.
    jobs: { enabled: process.env.JOBS_ENABLED !== 'false' },
    sso: { redirectUri: process.env.SSO_REDIRECT_URI?.trim() || undefined, providers: {} },
  };
  const provider = (id: SsoProviderId, prefix: string, issuer: string) => {
    const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim(), clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) cfg.sso.providers[id] = { clientId, clientSecret, issuer: (process.env[`${prefix}_ISSUER`]?.trim() || issuer).replace(/\/+$/, '') };
  };
  provider('microsoft', 'SSO_MICROSOFT', 'https://login.microsoftonline.com');
  provider('google', 'SSO_GOOGLE', 'https://accounts.google.com');
  if (Object.keys(cfg.sso.providers).length && !cfg.sso.redirectUri) throw new Error('SSO_REDIRECT_URI is required when an SSO provider is configured');
  if (cfg.env === 'production' && cfg.sso.redirectUri?.startsWith('http:')) throw new Error('SSO_REDIRECT_URI must use https in production');
  if (cfg.sso.redirectUri && !/^https?:\/\/[^/]+\/api\/auth\/sso\/callback$/.test(cfg.sso.redirectUri)) throw new Error('SSO_REDIRECT_URI must be https://<host>/api/auth/sso/callback');

  if (cfg.env === 'production' && cfg.db.synchronize) throw new Error('DB_SYNC=true is not allowed in production: use migrations');
  if (cfg.env === 'production' && cfg.webhooks.allowPrivate) throw new Error('WEBHOOK_ALLOW_PRIVATE=true is not allowed in production');
  if (cfg.env === 'production' && !cfg.auth.cookieSecure) throw new Error('COOKIE_SECURE=false is not allowed in production');
  return cfg;
}
