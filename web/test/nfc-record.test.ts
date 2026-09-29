import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phoneBadgeCode } from '../src/access/nfc-record.ts';

const view = (s: string) => new DataView(new TextEncoder().encode(s).buffer);
const code = 'DRE1:3f0c5a2e-1b7d-4c1e-9a55-2f1c7d0e9b11.58123456.0123456789abcdef';

test('the phone badge code is read from its text record', () => {
  assert.equal(phoneBadgeCode([{ recordType: 'text', encoding: 'utf-8', data: view(code) }]), code);
});

test('ordinary tags fall back to the serial number', () => {
  assert.equal(phoneBadgeCode(undefined), null);
  assert.equal(phoneBadgeCode([]), null);
  assert.equal(phoneBadgeCode([{ recordType: 'url', data: view('https://example.com') }]), null);
  assert.equal(phoneBadgeCode([{ recordType: 'text', data: view('hello') }]), null);
  assert.equal(phoneBadgeCode([{ recordType: 'text', data: view('DRE1:not-a-code') }]), null);
});
