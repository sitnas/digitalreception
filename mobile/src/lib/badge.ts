import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Pure badge logic, shared by the screens and the tests (no React Native imports here).
 * The QR is the same one the server checks: "DRE1:<employeeId>.<step>.<16 hex of HMAC-SHA256>",
 * with a new step every 30 seconds, computed on the phone without network.
 */
export const QR_PREFIX = 'DRE1:';

export interface Badge {
  /** https://<organisation host>, the server that issued the badge. */
  origin: string;
  employeeId: string;
  /** base64, 32 bytes. Kept only in the device keystore. */
  secret: string;
  /** seconds per QR code (30). */
  step: number;
  organisation: string;
  firstName: string;
  lastName: string;
  primaryColor: string | null;
  /** Second colour of the organisation; refreshed from the server at every start. */
  secondaryColor?: string | null;
  /** Token for the app's own requests (invitations). Missing on badges activated before this existed. */
  appToken?: string | null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, value = 0, i = 0;
  for (const c of clean) {
    value = (value << 6) | B64.indexOf(c); bits += 6;
    if (bits >= 8) { bits -= 8; out[i++] = (value >>> bits) & 255; }
  }
  return out.subarray(0, i);
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** First 16 hex characters of HMAC-SHA256(secret, "<employeeId>.<step>"), as on the server. */
export function signStep(secretB64: string, employeeId: string, step: number): string {
  return hex(hmac(sha256, base64ToBytes(secretB64), new TextEncoder().encode(`${employeeId}.${step}`))).slice(0, 16);
}

export function qrPayload(badge: Pick<Badge, 'employeeId' | 'secret'>, step: number): string {
  return `${QR_PREFIX}${badge.employeeId}.${step}.${signStep(badge.secret, badge.employeeId, step)}`;
}

/** Current step and seconds left before the next code. */
export function stepAt(nowMs: number, stepSeconds: number) {
  const seconds = Math.floor(nowMs / 1000);
  return { step: Math.floor(seconds / stepSeconds), left: stepSeconds - (seconds % stepSeconds) };
}

/**
 * Turns what the employee typed ("acme.example.com", "https://acme.example.com/badge") into the
 * organisation origin. Only https is accepted, except plain http to a local address in development.
 */
export function normaliseOrigin(input: string, allowLocalHttp = false): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  if (url.protocol === 'http:' && !(allowLocalHttp && local)) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return `${url.protocol}//${url.host}`;
}

/** Validates what the server returned at activation before it is stored. */
export function isBadge(v: unknown): v is Badge {
  const b = v as Badge;
  return !!b && typeof b.origin === 'string' && /^[0-9a-f-]{36}$/.test(b.employeeId) && typeof b.secret === 'string'
    && base64ToBytes(b.secret).length === 32 && Number.isInteger(b.step) && b.step > 0 && typeof b.organisation === 'string'
    && (b.appToken === undefined || b.appToken === null || /^dra_[A-Za-z0-9_-]{30,}$/.test(b.appToken));
}
