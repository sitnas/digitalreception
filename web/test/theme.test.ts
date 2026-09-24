// Brand colour maths: whatever an organisation picks, text and indicators must stay readable.
// Runs with Node's built-in test runner and type stripping: `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, brandVars, contrast, isHex, mix, readableOn } from '../src/lib/theme.ts';

const PRESETS = ['#FFD100', '#F97316', '#DC2626', '#DB2777', '#7C3AED', '#2563EB', '#0E7490', '#16A34A', '#111111', '#2B2B2B', '#1F2937', '#0F2A44', '#123524', '#3B1D2E'];
const SAMPLE = [...PRESETS, '#FFFFFF', '#000000', '#FFFF00', '#00FFFF', '#808080', '#F5F5F5', '#7F7F7F'];

test('contrast matches WCAG reference values', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 10) / 10, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#767676', '#FFFFFF') - 4.54) < 0.02);
});

test('text on any brand colour reaches at least 4.5:1 for the presets and 3:1 for anything', () => {
  for (const c of PRESETS) assert.ok(contrast(c, readableOn(c)) >= 4.5, `${c} -> ${readableOn(c)}`);
  for (const c of SAMPLE) assert.ok(contrast(c, readableOn(c)) >= 3, c);
});

test('the "strong" brand variant is always visible on white', () => {
  for (const p of SAMPLE) for (const s of SAMPLE) {
    const v = brandVars({ primaryColor: p, secondaryColor: s });
    assert.ok(contrast(v['--brand-strong'], '#FFFFFF') >= 3, `${p}/${s}`);
  }
});

test('menu section titles are readable on the secondary colour', () => {
  for (const p of SAMPLE) for (const s of SAMPLE) {
    const v = brandVars({ primaryColor: p, secondaryColor: s });
    assert.ok(contrast(v['--brand-on-2'], s) >= 3, `${p} on ${s}`);
  }
});

test('the dark tint keeps light text readable', () => {
  for (const p of SAMPLE) assert.ok(contrast(brandVars({ primaryColor: p })['--brand-soft-dark'], '#EDEDEA') >= 4.5, p);
});

test('invalid or missing colours fall back to the defaults', () => {
  const v = brandVars({ primaryColor: 'red', secondaryColor: null });
  assert.equal(v['--brand'], DEFAULT_PRIMARY);
  assert.equal(v['--brand-2'], DEFAULT_SECONDARY);
  assert.equal(isHex('#12345G'), false);
  assert.equal(isHex('#12345f'), true);
});

test('mix goes from one colour to the other', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(mix('#000000', '#FFFFFF', 1), '#FFFFFF');
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
});
