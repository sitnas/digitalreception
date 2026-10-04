import { AppConfig } from '../common/app-config';

/** Address of the pre-registration page for an invitation, or null when no public address is configured. */
export function guestLink(cfg: AppConfig, slug: string, code: string): string | null {
  if (!cfg.publicUrl) return null;
  const u = new URL(cfg.publicUrl);
  if (cfg.tenancy.mode === 'subdomain') u.hostname = `${slug}.${cfg.tenancy.baseDomain}`;
  // The code travels in the fragment: browsers never send it to the server or in the Referer.
  return `${u.origin}/guest#${code}`;
}
