import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'crypto';
import type { SsoProviderConfig, SsoProviderId } from '../common/app-config';

/**
 * Minimal OpenID Connect client for Microsoft Entra ID and Google: authorization code flow with
 * PKCE, ID token signature (RS256, keys from the provider's JWKS) and claims checked here.
 * No library: the two providers are fixed and every check is visible in this file.
 */

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface IdentityClaims {
  /** Stable, directory-scoped identifier of the person: "<provider>:<org>:<subject>". */
  subject: string;
  /** Microsoft Entra tenant id or Google Workspace domain. */
  orgId: string;
  /** Domain shown in the console. */
  orgLabel: string;
  email: string;
}

export class SsoError extends Error {}

const TIMEOUT_MS = 10_000;
const CACHE_MS = 60 * 60_000;
const CLOCK_SKEW_S = 300;
/** Personal Microsoft accounts (outlook.com…) share this tenant id: never a company directory. */
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const b64url = (b: Buffer) => b.toString('base64url');
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new SsoError(`PROVIDER_HTTP_${r.status}${(body as { error?: string }).error ? `:${(body as { error: string }).error}` : ''}`);
  return body as T;
}

export class OidcProvider {
  private discovery = new Map<string, { at: number; value: Discovery }>();
  private jwks = new Map<string, { at: number; keys: Map<string, KeyObject> }>();

  constructor(readonly id: SsoProviderId, private readonly cfg: SsoProviderConfig, private readonly redirectUri: string) {}

  /** Microsoft: the linked tenant, or "organizations" (any work account) while linking. Google: one issuer. */
  private configUrl(orgId: string | null) {
    return this.id === 'microsoft'
      ? `${this.cfg.issuer}/${orgId ?? 'organizations'}/v2.0/.well-known/openid-configuration`
      : `${this.cfg.issuer}/.well-known/openid-configuration`;
  }

  private async config(orgId: string | null): Promise<Discovery> {
    const url = this.configUrl(orgId);
    const hit = this.discovery.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await getJson<Discovery>(url);
    this.discovery.set(url, { at: Date.now(), value });
    return value;
  }

  async authorizeUrl(p: { orgId: string | null; state: string; nonce: string; codeVerifier: string; loginHint?: string }) {
    const d = await this.config(p.orgId);
    const q = new URLSearchParams({
      client_id: this.cfg.clientId, response_type: 'code', redirect_uri: this.redirectUri, scope: 'openid email profile',
      state: p.state, nonce: p.nonce, code_challenge: pkceChallenge(p.codeVerifier), code_challenge_method: 'S256', prompt: 'select_account',
    });
    if (this.id === 'microsoft') q.set('response_mode', 'query');
    // Google: offers only accounts of the linked Workspace domain (a hint; the claim is checked anyway).
    if (this.id === 'google' && p.orgId) q.set('hd', p.orgId);
    if (p.loginHint) q.set('login_hint', p.loginHint);
    return `${d.authorization_endpoint}?${q}`;
  }

  /** Exchanges the code (with the PKCE verifier) and returns the verified identity. */
  async redeem(p: { code: string; codeVerifier: string; nonce: string; orgId: string | null }): Promise<IdentityClaims> {
    const d = await this.config(p.orgId);
    const tokens = await getJson<{ id_token?: string }>(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: p.code, redirect_uri: this.redirectUri, code_verifier: p.codeVerifier,
        client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: 'openid email profile',
      }),
    });
    if (!tokens.id_token) throw new SsoError('NO_ID_TOKEN');
    const claims = await this.verifyIdToken(tokens.id_token, d);
    if (claims.nonce !== p.nonce) throw new SsoError('NONCE_MISMATCH');
    return this.identity(claims, d, p.orgId);
  }

  private async key(jwksUri: string, kid: string): Promise<KeyObject> {
    let hit = this.jwks.get(jwksUri);
    // Unknown kid: the provider may have rotated its keys, fetch again (at most once a minute).
    if (!hit || (!hit.keys.has(kid) && Date.now() - hit.at > 60_000) || Date.now() - hit.at > CACHE_MS) {
      const { keys } = await getJson<{ keys: (JsonWebKey & { kid?: string; kty?: string; use?: string })[] }>(jwksUri);
      hit = { at: Date.now(), keys: new Map(keys.filter((k) => k.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig')).map((k) => [k.kid!, createPublicKey({ key: k, format: 'jwk' })])) };
      this.jwks.set(jwksUri, hit);
    }
    const key = hit.keys.get(kid);
    if (!key) throw new SsoError('UNKNOWN_SIGNING_KEY');
    return key;
  }

  private async verifyIdToken(token: string, d: Discovery): Promise<Record<string, unknown>> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new SsoError('MALFORMED_TOKEN');
    let header: { alg?: string; kid?: string }, claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw new SsoError('MALFORMED_TOKEN'); }
    if (header.alg !== 'RS256' || !header.kid) throw new SsoError('UNSUPPORTED_TOKEN');
    const ok = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await this.key(d.jwks_uri, header.kid), Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new SsoError('BAD_SIGNATURE');

    const now = Math.floor(Date.now() / 1000);
    const aud = claims.aud;
    if (!(aud === this.cfg.clientId || (Array.isArray(aud) && aud.includes(this.cfg.clientId)))) throw new SsoError('WRONG_AUDIENCE');
    if (Array.isArray(aud) && aud.length > 1 && claims.azp !== this.cfg.clientId) throw new SsoError('WRONG_AUDIENCE');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new SsoError('TOKEN_EXPIRED');
    if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_S > now) throw new SsoError('TOKEN_NOT_YET_VALID');
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) throw new SsoError('TOKEN_NOT_YET_VALID');
    return claims;
  }

  private identity(c: Record<string, unknown>, d: Discovery, orgId: string | null): IdentityClaims {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    if (this.id === 'microsoft') {
      const tid = str(c.tid), oid = str(c.oid);
      if (!tid || !oid || tid === MSA_TENANT) throw new SsoError('NOT_A_WORK_ACCOUNT');
      // The "organizations" document has "{tenantid}" in the issuer: the token must name its own tenant.
      if (c.iss !== d.issuer.replace('{tenantid}', tid)) throw new SsoError('WRONG_ISSUER');
      if (orgId && tid !== orgId) throw new SsoError('OTHER_DIRECTORY');
      // The user principal name belongs to a domain verified in the tenant; "email" can be set freely.
      const email = (str(c.preferred_username) ?? str(c.email) ?? '').toLowerCase();
      if (!email.includes('@')) throw new SsoError('NO_EMAIL');
      return { subject: `microsoft:${tid}:${oid}`, orgId: tid, orgLabel: email.split('@')[1], email };
    }
    const iss = str(c.iss), sub = str(c.sub), hd = str(c.hd)?.toLowerCase() ?? null, email = str(c.email)?.toLowerCase() ?? null;
    if (iss !== d.issuer && `https://${iss}` !== d.issuer) throw new SsoError('WRONG_ISSUER');
    // "hd" is present only for Google Workspace accounts (not @gmail.com) and is set by Google.
    if (!hd) throw new SsoError('NOT_A_WORK_ACCOUNT');
    if (orgId && hd !== orgId) throw new SsoError('OTHER_DIRECTORY');
    if (!sub || !email || c.email_verified !== true) throw new SsoError('NO_EMAIL');
    return { subject: `google:${hd}:${sub}`, orgId: hd, orgLabel: hd, email };
  }
}
