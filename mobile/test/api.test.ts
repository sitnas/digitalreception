import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, getTenant, listInvites } from '../src/lib/api.ts';

const answer = (body: string, status = 200, type = 'application/json') => {
  globalThis.fetch = (async () => new Response(body, { status, headers: { 'Content-Type': type } })) as typeof fetch;
};
const badge = { origin: 'https://acme.example', appToken: 'dra_x' };

test('a page that is not JSON (a login wall answering 200) is an error, not an empty list', async () => {
  answer('<!doctype html><title>Sign in to GitHub</title>', 200, 'text/html');
  await assert.rejects(listInvites(badge), (e: unknown) => e instanceof ApiError && e.code === 'BAD_RESPONSE');
  await assert.rejects(getTenant('https://acme.example'), (e: unknown) => e instanceof ApiError && e.code === 'BAD_RESPONSE');
});

test('JSON that is not a list of invitations is an error too', async () => {
  answer('{"status":"ok"}');
  await assert.rejects(listInvites(badge), (e: unknown) => e instanceof ApiError && e.code === 'BAD_RESPONSE');
});

test('server errors keep their code; a list comes through', async () => {
  answer('{"message":"NOT_A_HOST","statusCode":403}', 403);
  await assert.rejects(listInvites(badge), (e: unknown) => e instanceof ApiError && e.code === 'NOT_A_HOST' && e.status === 403);
  answer('[]');
  assert.deepEqual(await listInvites(badge), []);
});

test('a server that never answers ends as a network error, not an endless wait', async () => {
  const { network } = await import('../src/lib/api.ts');
  network.timeoutMs = 50;
  globalThis.fetch = ((_: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as typeof fetch;
  const started = Date.now();
  await assert.rejects(listInvites(badge), (e: unknown) => !(e instanceof ApiError));
  assert.ok(Date.now() - started < 1000);
  network.timeoutMs = 15_000;
});
