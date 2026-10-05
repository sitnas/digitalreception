import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activePill, contrast } from '../src/lib/color.ts';

test('active tab: black pill with yellow text by default, readable with any organisation colours', () => {
  assert.deepEqual(activePill('#FFD60A', null), { bg: '#0A0A0A', fg: '#FFD60A' });
  // A dark primary on a dark secondary would vanish: the label falls back to white.
  assert.deepEqual(activePill('#1D4ED8', '#0F2A44'), { bg: '#0F2A44', fg: '#FFFFFF' });
  // A light secondary takes black text.
  assert.equal(activePill('#FFD60A', '#DBEAFE').fg, '#0A0A0A');
  for (const [p, s] of [['#FFD60A', null], ['#0F766E', '#7C2D12'], ['#F97316', '#FFFFFF'], ['#16A34A', 'bad']] as const) {
    const { bg, fg } = activePill(p, s);
    assert.ok(contrast(bg, fg) >= 3, `${p} on ${s}`);
  }
});
