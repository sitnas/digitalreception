/**
 * Decorative patterns for the module cards (docs: card guidelines). Each one is a pure function of
 * an id: the same card always gets the same drawing, on the server, in the browser and, later, in the
 * mobile app. Everything is drawn in currentColor; the card decides the colour and the opacity.
 * Attribute names are camelCase, as React and React Native SVG take them.
 */
export type PatternId = 'contour' | 'dotWave' | 'chevrons' | 'dotCluster' | 'stripeDisc' | 'dashes';
export const PATTERN_IDS: PatternId[] = ['contour', 'dotWave', 'chevrons', 'dotCluster', 'stripeDisc', 'dashes'];

export interface SvgEl { tag: 'path' | 'line' | 'rect' | 'g' | 'defs' | 'clipPath' | 'circle'; attrs: Record<string, string | number>; children?: SvgEl[] }
export interface Pattern { viewBox: string; elements: SvgEl[] }

/** FNV-1a: a stable 32-bit hash of a string. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: small, fast, deterministic PRNG returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Many dots as a single path of arcs: one DOM node instead of dozens. */
const dots = (pts: [number, number, number][]) =>
  pts.map(([x, y, r]) => `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`).join('');

/** Points spread out in a disc, never closer than `min` to each other (dart throwing). */
function scatter(rand: () => number, n: number, cx: number, cy: number, radius: number, min: number): [number, number][] {
  const out: [number, number][] = [];
  for (let tries = 0; out.length < n && tries < n * 60; tries++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius;
    const p: [number, number] = [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
    if (out.every(([x, y]) => (x - p[0]) ** 2 + (y - p[1]) ** 2 >= min * min)) out.push(p);
  }
  return out;
}

const GENERATORS: Record<PatternId, (rand: () => number, uid: string) => SvgEl[]> = {
  /** Nine level lines: the same two sine waves, slightly shifted per line, brighter towards the corner. */
  contour: (rand) => {
    const f1 = 0.025 + rand() * 0.015, f2 = 0.05 + rand() * 0.03, p1 = rand() * 6, p2 = rand() * 6;
    return Array.from({ length: 9 }, (_, i) => {
      const pts: string[] = [];
      for (let x = -20; x <= 220; x += 8) {
        const y = 12 + i * 25 + Math.sin(x * f1 + p1 + i * 0.15) * 14 + Math.sin(x * f2 + p2 - i * 0.1) * 7;
        pts.push(`${x} ${r1(y)}`);
      }
      return { tag: 'path', attrs: { d: `M${pts.join('L')}`, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: (0.35 + i * 0.075).toFixed(2) } };
    });
  },
  /** A 16 × 16 grid of dots whose radius fades with the distance from a sine wave. */
  dotWave: (rand) => {
    const f = 0.02 + rand() * 0.015, ph = rand() * 6, amp = 45 + rand() * 20;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const x = 6 + i * 12.5, y = 6 + j * 12.5;
      const d = Math.abs(y - (110 - Math.sin(x * f + ph) * amp));
      const r = 4.7 * Math.max(0, 1 - d / 40);
      if (r > 0.8) pts.push([x, y, r]);
    }
    return [{ tag: 'path', attrs: { d: dots(pts), fill: 'currentColor' } }];
  },
  /** Five chevrons, same thickness, same step. */
  chevrons: (rand) => {
    const top = 50 + rand() * 16;
    return Array.from({ length: 5 }, (_, i) => ({
      tag: 'path',
      attrs: { d: `M20 ${r1(top + 130 + i * 26)}L150 ${r1(top + i * 26)}L280 ${r1(top + 130 + i * 26)}`, fill: 'none', stroke: 'currentColor', strokeWidth: 12, strokeLinejoin: 'miter' },
    }));
  },
  /** About fifty dots in a disc, larger towards its centre. */
  dotCluster: (rand) => {
    const pts = scatter(rand, 52, 140, 140, 90, 13).map(([x, y]): [number, number, number] => {
      const d = Math.hypot(x - 140, y - 140) / 90;
      return [x, y, 2.2 + (1 - d) * 5 * (0.75 + rand() * 0.25)];
    });
    return [{ tag: 'path', attrs: { d: dots(pts), fill: 'currentColor' } }];
  },
  /** A disc cut out of tilted stripes of varying thickness. */
  stripeDisc: (rand, uid) => {
    const rects: SvgEl[] = [];
    for (let y = 56; y < 246;) {
      const h = 4.4 + rand() * 9.3;
      rects.push({ tag: 'rect', attrs: { x: 46, y: r1(y), width: 208, height: r1(h), fill: 'currentColor' } });
      y += h + 7 + rand() * 3;
    }
    const id = `pd-${uid}`;
    const out: SvgEl[] = [
      { tag: 'defs', attrs: {}, children: [{ tag: 'clipPath', attrs: { id }, children: [{ tag: 'circle', attrs: { cx: 150, cy: 150, r: 84 } }] }] },
      { tag: 'g', attrs: { clipPath: `url(#${id})` }, children: [{ tag: 'g', attrs: { transform: 'rotate(-35 150 150)' }, children: rects }] },
    ];
    return out;
  },
  /** Rounded dashes at about 70 degrees, each turned by up to 30 degrees either way. */
  dashes: (rand) => scatter(rand, 28, 140, 140, 85, 16).map(([x, y]) => {
    const a = ((70 + (rand() * 60 - 30)) * Math.PI) / 180, len = 10 + rand() * 12;
    const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
    return { tag: 'line', attrs: { x1: r1(x - dx), y1: r1(y - dy), x2: r1(x + dx), y2: r1(y + dy), stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round' } };
  }),
};

/** The pattern for a card: the seed is the card id plus the pattern, so ids never share a drawing. */
export function generatePattern(id: PatternId, seed: string): Pattern {
  const h = fnv1a(`${seed}:${id}`);
  return { viewBox: '0 0 200 200', elements: GENERATORS[id](mulberry32(h), h.toString(36)) };
}

/** Number of SVG nodes, for the budget of 300 per pattern. */
export const countNodes = (els: SvgEl[]): number => els.reduce((n, e) => n + 1 + countNodes(e.children ?? []), 0);
