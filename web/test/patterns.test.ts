// Patterns of the module cards: stable per id, different between ids, within the node budget.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATTERN_IDS, countNodes, generatePattern } from '../src/lib/patterns.ts';

test('same id, same drawing; different ids, different drawings', () => {
  for (const p of PATTERN_IDS) {
    assert.deepEqual(generatePattern(p, 'reception'), generatePattern(p, 'reception'), p);
    assert.notDeepEqual(generatePattern(p, 'reception'), generatePattern(p, 'parking'), p);
  }
});

test('every pattern draws something and stays under 300 nodes', () => {
  for (const p of PATTERN_IDS) for (const id of ['reception', 'access', 'parcels', 'parking', 'add']) {
    const n = countNodes(generatePattern(p, id).elements);
    assert.ok(n > 0 && n < 300, `${p}/${id}: ${n}`);
  }
});

test('clip paths get an id of their own, so two cards on a page never share one', () => {
  const ids = ['reception', 'access'].map((id) => JSON.stringify(generatePattern('stripeDisc', id)).match(/"id":"([^"]+)"/)![1]);
  assert.notEqual(ids[0], ids[1]);
});
