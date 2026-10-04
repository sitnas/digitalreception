import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Badge activation with the company account (pure helpers, tested with Node). The app keeps a random
 * verifier and sends only its SHA-256: the one-time code that comes back through the app's address
 * is useless to any other app that might catch that address, because it does not know the verifier.
 */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64url(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 6) { bits -= 6; out += B64URL[(value >>> bits) & 63]; }
  }
  if (bits > 0) out += B64URL[(value << (6 - bits)) & 63];
  return out;
}

export function pkcePair(random: Uint8Array): { verifier: string; challenge: string } {
  const verifier = base64url(random);
  const challenge = Array.from(sha256(new TextEncoder().encode(verifier)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { verifier, challenge };
}

/** Address the app opens in the system browser. */
export function badgeSsoUrl(origin: string, challenge: string, returnTo: string): string {
  return `${origin}/api/auth/sso/badge?challenge=${challenge}&return=${encodeURIComponent(returnTo)}`;
}

/** What the server put on the app's address: a one-time code, or the reason it refused. */
export function readReturn(url: string): { code: string } | { error: string } {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new Map(query.split('&').filter(Boolean).map((kv) => {
    const [k, v = ''] = kv.split('=');
    return [decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' '))] as const;
  }));
  const code = params.get('code');
  if (code) return { code };
  return { error: params.get('error') || 'EXPIRED' };
}
