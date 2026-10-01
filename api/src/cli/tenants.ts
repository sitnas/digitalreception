import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { DataSource, In, IsNull } from 'typeorm';
import { loadConfig } from '../common/app-config';
import { CryptoService } from '../common/crypto.service';
import { createStorage } from '../common/storage';
import { TenantKeysService } from '../common/tenant-keys.service';
import { presetFor } from '../database/country-presets';
import { noticeTemplate } from '../database/notice-templates';
import { typeormOptions } from '../database/typeorm-options';
import { AccessEvent, AccessRule, ApiKey, Door, DoorReader, Employee, ActorType, AuditLog, CountryPolicy, Device, Host, Invitation, PairingCode, PrivacyNotice, Role, Site, SsoRequest, StoredFile, Tenant, TenantStatus, User, Visit, Webhook, WebhookDelivery, PlatformSecret, PushDevice, PushDelivery } from '../entities';

/**
 * Platform operations (provisioning of customer organisations). Deliberately a CLI and not a
 * web page: there is no "platform super-user" exposed on the internet.
 *
 *   npm run tenant -- create --slug acme --name "Acme S.p.A." --countries IT,ES --admin-email it@acme.com [--max-sites 5 --max-devices 5 --max-users 20]
 *   npm run tenant -- list
 *   npm run tenant -- limits --slug acme --max-sites 10
 *   npm run tenant -- suspend --slug acme      |  activate --slug acme
 *   npm run tenant -- delete --slug acme --confirm acme     (crypto-shredding, irreversible)
 *   npm run tenant -- rewrap-keys                            (after adding a new MASTER_KEYS entry)
 *   npm run tenant -- reset-mfa --slug acme --email it@acme.com   (last resort: the only administrator lost phone and recovery codes)
 *   npm run tenant -- reset-password --slug acme --email it@acme.com   (last resort: the only administrator forgot the password)
 *   npm run tenant -- sso-off --slug acme      (last resort: the directory is unreachable and no emergency account works)
 */
function args() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? 'true' : rest[++i];
  return { cmd, opts };
}
const limit = (v?: string) => (v === undefined ? undefined : v === 'none' ? null : Math.max(0, parseInt(v, 10)));
const tempPassword = () => randomBytes(12).toString('base64url') + '-A7';

async function platformAudit(ds: DataSource, action: string, details: Record<string, unknown>) {
  await ds.getRepository(AuditLog).insert({ tenantId: null, at: new Date(), actorType: ActorType.SYSTEM, actorId: null, actorLabel: `cli:${process.env.USER ?? 'operator'}`, action, entityType: 'tenant', entityId: null, siteId: null, ip: null, details: details as never });
}

async function main() {
  const { cmd, opts } = args();
  const cfg = loadConfig();
  const ds = await new DataSource(typeormOptions(cfg)).initialize();
  if (!cfg.db.synchronize) await ds.runMigrations();
  const crypto = new CryptoService(cfg);
  const keys = new TenantKeysService(crypto, ds.getRepository(Tenant));
  const tenants = ds.getRepository(Tenant);

  try {
    switch (cmd) {
      case 'create': {
        const slug = (opts.slug ?? '').toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) || slug.length < 2) throw new Error('--slug: 2-40 chars, a-z 0-9 and "-"');
        if (!opts.name) throw new Error('--name is required');
        const adminEmail = opts['admin-email']?.trim().toLowerCase();
        if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('--admin-email is required');
        if (await tenants.exist({ where: { slug } })) throw new Error(`Tenant ${slug} already exists`);
        const countries = (opts.countries ?? 'IT').split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
        const password = tempPassword();

        await ds.transaction(async (em) => {
          const t = em.create(Tenant, { slug, name: opts.name, status: TenantStatus.ACTIVE, dataKeyId: 'd1', dataKeysWrapped: '{}', blindIndexKeyWrapped: '',
            maxSites: limit(opts['max-sites']) ?? null, maxDevices: limit(opts['max-devices']) ?? null, maxUsers: limit(opts['max-users']) ?? null, logoDataUrl: null });
          const saved = await em.save(t);
          await em.update(Tenant, saved.id, keys.generate(saved.id)); // keys are bound to the tenant id
          for (const cc of countries) {
            const p = presetFor(cc);
            await em.save(em.create(CountryPolicy, { tenantId: saved.id, countryCode: cc, ...p }));
            for (const locale of p.locales) await em.save(em.create(PrivacyNotice, { tenantId: saved.id, countryCode: cc, locale, version: 1, createdBy: null, ...noticeTemplate(cc, locale) }));
          }
          await em.save(em.create(User, { tenantId: saved.id, email: adminEmail, displayName: 'Amministratore', role: Role.SUPER_ADMIN, sites: [], active: true, mustChangePassword: true, passwordHash: await crypto.hashPassword(password) }));
        });
        await platformAudit(ds, 'TENANT_CREATED', { slug, countries });
        console.log(`Tenant "${slug}" created with countries ${countries.join(', ')}.`);
        console.log(`Console: ${cfg.tenancy.mode === 'subdomain' ? `https://${slug}.${cfg.tenancy.baseDomain}/admin` : '/admin'}`);
        console.log(`First administrator: ${adminEmail}`);
        console.log(`Temporary password (shown ONCE, change required at first login): ${password}`);
        break;
      }
      case 'list': {
        const rows = await tenants.find({ order: { slug: 'ASC' } });
        for (const t of rows) {
          const [sites, devices, users] = await Promise.all([
            ds.getRepository(Site).count({ where: { tenantId: t.id, active: true } }),
            ds.getRepository(Device).count({ where: { tenantId: t.id, revokedAt: IsNull() } }),
            ds.getRepository(User).count({ where: { tenantId: t.id, active: true } }),
          ]);
          console.log(`${t.slug.padEnd(20)} ${t.status.padEnd(10)} sites ${sites}/${t.maxSites ?? '∞'}  devices ${devices}/${t.maxDevices ?? '∞'}  users ${users}/${t.maxUsers ?? '∞'}  ${t.name}`);
        }
        break;
      }
      case 'limits': case 'suspend': case 'activate': {
        const t = await tenants.findOne({ where: { slug: opts.slug } });
        if (!t) throw new Error('Tenant not found');
        const patch: Partial<Tenant> = {};
        if (cmd === 'suspend') patch.status = TenantStatus.SUSPENDED;
        if (cmd === 'activate') patch.status = TenantStatus.ACTIVE;
        if (cmd === 'limits') {
          for (const [k, col] of [['max-sites', 'maxSites'], ['max-devices', 'maxDevices'], ['max-users', 'maxUsers']] as const) {
            const v = limit(opts[k]); if (v !== undefined) patch[col] = v;
          }
        }
        await tenants.update(t.id, patch);
        await platformAudit(ds, `TENANT_${cmd.toUpperCase()}`, { slug: t.slug, ...patch });
        console.log(`Tenant ${t.slug} updated (${JSON.stringify(patch)}). API replicas pick it up within 60 seconds.`);
        break;
      }
      case 'delete': {
        const t = await tenants.findOne({ where: { slug: opts.slug } });
        if (!t) throw new Error('Tenant not found');
        if (opts.confirm !== t.slug) throw new Error('Add --confirm <slug> to confirm: this is irreversible');
        // 1) crypto-shredding: without its keys the tenant's ciphertexts are unreadable, even in DB backups.
        await tenants.update(t.id, { dataKeysWrapped: '{}', blindIndexKeyWrapped: '', status: TenantStatus.SUSPENDED });
        // 2) physical deletion of blobs and rows.
        const storage = createStorage(cfg);
        for (const f of await ds.getRepository(StoredFile).find({ where: { tenantId: t.id } })) if (!f.purgedAt && f.storagePath) await storage.delete(f.storagePath);
        await ds.transaction(async (em) => {
          const userIds = (await em.find(User, { where: { tenantId: t.id }, select: { id: true } })).map((u) => u.id);
          if (userIds.length) await em.createQueryBuilder().delete().from('user_sites').where({ userId: In(userIds) }).execute();
          // Hosts after visits (visits reference them); host_sites rows go with their host (ON DELETE CASCADE).
          for (const entity of [PushDelivery, PushDevice, WebhookDelivery, Webhook, SsoRequest, AccessEvent, AccessRule, DoorReader, Employee, Door, ApiKey, StoredFile, Invitation, Visit, Host, Device, PairingCode, User, PrivacyNotice, Site, CountryPolicy, AuditLog]) await em.delete(entity, { tenantId: t.id });
          await em.delete(Tenant, { id: t.id });
        });
        await platformAudit(ds, 'TENANT_DELETED', { slug: t.slug });
        console.log(`Tenant ${t.slug} deleted. Keys destroyed: data remaining in older backups can no longer be decrypted.`);
        break;
      }
      case 'rewrap-keys': {
        let n = 0;
        for (const t of await tenants.createQueryBuilder('t').addSelect(['t.dataKeysWrapped', 't.blindIndexKeyWrapped']).getMany()) {
          if (!t.blindIndexKeyWrapped) continue;
          const deks = JSON.parse(t.dataKeysWrapped) as Record<string, string>;
          const rewrapped = Object.fromEntries(Object.entries(deks).map(([kid, w]) => [kid, crypto.needsRewrap(w) ? crypto.wrapKey(crypto.unwrapKey(w, t.id, `dek:${kid}`), t.id, `dek:${kid}`) : w]));
          const bik = crypto.needsRewrap(t.blindIndexKeyWrapped) ? crypto.wrapKey(crypto.unwrapKey(t.blindIndexKeyWrapped, t.id, 'bik'), t.id, 'bik') : t.blindIndexKeyWrapped;
          await tenants.update(t.id, { dataKeysWrapped: JSON.stringify(rewrapped), blindIndexKeyWrapped: bik });
          n++;
        }
        const secrets = ds.getRepository(PlatformSecret);
        for (const p of await secrets.find()) {
          if (crypto.needsRewrap(p.valueWrapped)) await secrets.update(p.name, { valueWrapped: crypto.wrapKey(crypto.unwrapKey(p.valueWrapped, 'platform', p.name), 'platform', p.name) });
        }
        await platformAudit(ds, 'MASTER_KEY_REWRAP', { tenants: n });
        console.log(`${n} tenants re-wrapped with the active master key. Old master keys can be removed after all replicas restart.`);
        break;
      }
      case 'reset-mfa': {
        const t = await tenants.findOne({ where: { slug: opts.slug } });
        if (!t) throw new Error('Tenant not found');
        const users = ds.getRepository(User);
        const u = await users.findOne({ where: { tenantId: t.id, email: (opts.email ?? '').trim().toLowerCase() } });
        if (!u) throw new Error('User not found');
        await users.update(u.id, { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: null, sessionVersion: u.sessionVersion + 1 });
        await platformAudit(ds, 'USER_MFA_RESET', { slug: t.slug, userId: u.id });
        console.log(`Two-step verification reset for ${u.email}: sessions revoked, set-up asked again at the next login${t.mfaRequired ? ' (required by the organisation)' : ''}.`);
        break;
      }
      case 'reset-password': {
        const t = await tenants.findOne({ where: { slug: opts.slug } });
        if (!t) throw new Error('Tenant not found');
        const users = ds.getRepository(User);
        const u = await users.findOne({ where: { tenantId: t.id, email: (opts.email ?? '').trim().toLowerCase() } });
        if (!u) throw new Error('User not found');
        const password = tempPassword();
        // Also lifts a lock from failed attempts; two-step verification, if enabled, stays on.
        await users.update(u.id, { passwordHash: await crypto.hashPassword(password), mustChangePassword: true, active: true, failedLogins: 0, lockedUntil: null, sessionVersion: u.sessionVersion + 1 });
        await platformAudit(ds, 'USER_PASSWORD_RESET', { slug: t.slug, userId: u.id });
        console.log(`Temporary password for ${u.email} (shown once, to be changed at the next login): ${password}`);
        break;
      }
      case 'sso-off': {
        const t = await tenants.findOne({ where: { slug: opts.slug } });
        if (!t) throw new Error('Tenant not found');
        await tenants.update(t.id, { ssoEnforced: false });
        await platformAudit(ds, 'TENANT_SSO_OFF', { slug: t.slug });
        console.log(`Single sign-on no longer required for ${t.slug}: users can sign in with their password again. The directory stays linked.`);
        break;
      }
      default:
        console.log('Commands: create | list | limits | suspend | activate | delete | rewrap-keys | reset-mfa | reset-password | sso-off  (see header of src/cli/tenants.ts)');
        process.exitCode = 1;
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
