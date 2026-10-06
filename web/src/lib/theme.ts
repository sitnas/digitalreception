/**
 * White-label theming. Each organisation picks a primary and a secondary colour; everything else
 * (hover, tint, text on top, a variant safe for thin indicators on white) is derived here, so no
 * choice can produce unreadable text.
 */
export interface BrandColors { primaryColor?: string | null; secondaryColor?: string | null }

export const DEFAULT_PRIMARY = '#FFD60A';
export const DEFAULT_SECONDARY = '#0A0A0A';
const INK = '#0A0A0A';
const WHITE = '#FFFFFF';

export const isHex = (v: string | null | undefined): v is string => !!v && /^#[0-9A-Fa-f]{6}$/.test(v);

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` towards `target` by `amount` (0 = hex, 1 = target). */
export function mix(hex: string, target: string, amount: number): string {
  const a = rgb(hex), b = rgb(target);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

/** Near-black or white, whichever reads better on the background. */
export function readableOn(bg: string): string {
  return contrast(bg, INK) >= contrast(bg, WHITE) ? INK : WHITE;
}

/** CSS custom properties for a brand. Usable on :root or on a single element (live preview). */
export function brandVars(colors: BrandColors): Record<string, string> {
  const p = isHex(colors.primaryColor) ? colors.primaryColor.toUpperCase() : DEFAULT_PRIMARY;
  const s = isHex(colors.secondaryColor) ? colors.secondaryColor.toUpperCase() : DEFAULT_SECONDARY;
  const onP = readableOn(p);
  const onS = readableOn(s);
  // A thin line, focus ring or small text on white needs 3:1. Fall back to the secondary, then to ink.
  const strong = contrast(p, WHITE) >= 3 ? p : contrast(s, WHITE) >= 3 ? s : INK;
  // Accent text on the secondary colour (menu section titles): the brand if it stands out, else plain text.
  const brandOn2 = contrast(p, s) >= 3 ? p : onS;
  return {
    '--brand': p,
    '--brand-hover': onP === INK ? mix(p, '#000000', 0.08) : mix(p, WHITE, 0.12),
    '--brand-soft': mix(p, WHITE, 0.86),
    // Same tint for dark surfaces: light text must stay readable on it.
    '--brand-soft-dark': mix(p, '#1A1A19', 0.8),
    '--on-brand': onP,
    '--brand-strong': strong,
    '--brand-2': s,
    '--brand-2-hover': mix(s, onS, 0.1),
    '--brand-2-line': mix(s, onS, 0.16),
    '--on-brand-2': onS,
    '--on-brand-2-muted': mix(onS, s, 0.32),
    '--brand-on-2': brandOn2,
    // Glyphs on a tile filled with that accent (module cards).
    '--on-brand-on-2': readableOn(brandOn2),
  };
}

/** Applies the brand to the whole document and to the browser chrome colour. */
export function applyBrand(colors: BrandColors): void {
  const vars = brandVars(colors);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--brand-2']);
}

/** Grey, black and white make dull squares: only a real colour (some saturation) counts as a second one. */
const chromatic = (hex: string) => { const c = rgb(hex); return (Math.max(...c) - Math.min(...c)) / 255 >= 0.25; };

/**
 * Colours of the twinkling squares (tablet, /badge): the primary, plus the secondary on about a third
 * of them when it is a real colour that differs from the primary. Same rule as the app.
 */
export function squareColors(primary: string | null | undefined, secondary: string | null | undefined): { primary: [number, number, number]; secondary: [number, number, number] | null } {
  const p = isHex(primary) ? primary : DEFAULT_PRIMARY;
  const ok = isHex(secondary) && chromatic(secondary) && contrast(secondary, p) >= 1.3;
  return { primary: rgb(p), secondary: ok ? rgb(secondary) : null };
}

/** Deterministic per square: about a third of them take the secondary colour. */
export const usesSecondary = (i: number) => { const v = Math.sin(i * 1.731 + 9.21) * 4321.123; return v - Math.floor(v) < 0.35; };

/** The brand colours currently applied to the page (they may arrive after the first paint). */
export function currentBrand(): { primary: string; secondary: string } {
  const cs = getComputedStyle(document.documentElement);
  return { primary: cs.getPropertyValue('--brand').trim(), secondary: cs.getPropertyValue('--brand-2').trim() };
}

/** Calls `fn` whenever applyBrand changes the colours on the document. Returns the unsubscribe. */
export function onBrandChange(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  return () => mo.disconnect();
}
