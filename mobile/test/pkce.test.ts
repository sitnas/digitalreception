import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { badgeSsoUrl, base64url, pkcePair, readReturn } from '../src/lib/pkce.ts';

test('base64url matches Node for any length', () => {
  for (let n = 0; n < 40; n++) {
    const b = randomBytes(n);
    assert.equal(base64url(b), b.toString('base64url'));
  }
});

test('the challenge is the hex SHA-256 of the verifier, as the server checks', () => {
  const { verifier, challenge } = pkcePair(randomBytes(32));
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('hex'));
});

test('start address and the way back', () => {
  assert.equal(badgeSsoUrl('https://acme.example', 'ab', 'exp://10.0.0.1:8081/--/sso'), 'https://acme.example/api/auth/sso/badge?challenge=ab&return=exp%3A%2F%2F10.0.0.1%3A8081%2F--%2Fsso');
  assert.deepEqual(readReturn('drbadge://sso?code=Abc_123-x'), { code: 'Abc_123-x' });
  assert.deepEqual(readReturn('exp://10.0.0.1:8081/--/sso?error=NO_EMPLOYEE'), { error: 'NO_EMPLOYEE' });
  assert.deepEqual(readReturn('drbadge://sso'), { error: 'EXPIRED' });
});
