/** Colour maths without React Native imports (tested with Node). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Text on the organisation colour: whichever of dark ink and white contrasts more (as on the web console). */
export function onColor(hex: string): string {
  return contrast(hex, '#0A0A0A') >= contrast(hex, '#FFFFFF') ? '#0A0A0A' : '#FFFFFF';
}


/** Grey, black and white make dull squares: only a real colour (some saturation) counts as a second one. */
function chromatic(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (Math.max(...c) - Math.min(...c)) / 255 >= 0.25;
}

/**
 * Colours of the twinkling squares: the organisation's primary colour, plus its secondary one on
 * about a third of the squares when it shows on the background and differs from the primary.
 * Returns null for the secondary when it would be invisible or look like the primary.
 */
export function squareColors(primary: string, secondary: string | null | undefined, background: string): { primary: string; secondary: string | null } {
  const ok = !!secondary && /^#[0-9A-Fa-f]{6}$/.test(secondary) && chromatic(secondary) && contrast(secondary, background) >= 1.5 && contrast(secondary, primary) >= 1.3;
  return { primary, secondary: ok ? secondary! : null };
}

/** Deterministic per square (no flicker between renders): about a third of them take the secondary colour. */
export const usesSecondary = (i: number) => { const v = Math.sin(i * 1.731 + 9.21) * 4321.123; return v - Math.floor(v) < 0.35; };
