import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30 s), the format every
 * authenticator app understands (Google/Microsoft Authenticator, 1Password, Authy…).
 */
export const TOTP_STEP_S = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 as authenticator apps expect it. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (atMs = Date.now()) => Math.floor(atMs / 1000 / TOTP_STEP_S);

export function totpCode(secretB32: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, '0');
}

/**
 * Returns the matched time step, or null. One step of clock drift is accepted either way;
 * steps up to `lastStep` are refused, so an intercepted code cannot be used a second time.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, atMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(atMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secretB32, step)), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secretB32: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_S}`;
}

/** Recovery codes: 10 × "XXXXX-XXXXX" from an unambiguous alphabet; only their hashes are stored. */
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => RC_ALPHABET[x % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normaliseRecoveryCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashRecoveryCode = (c: string) => createHash('sha256').update(normaliseRecoveryCode(c)).digest('hex');
