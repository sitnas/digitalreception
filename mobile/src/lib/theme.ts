import { useColorScheme } from 'react-native';

const DEFAULT_PRIMARY = '#FFD100';

/** Readable text on top of the organisation colour (WCAG relative luminance). */
function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#FFFFFF';
}

export function useTheme(primaryColor?: string | null) {
  const dark = useColorScheme() === 'dark';
  const primary = primaryColor && /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_PRIMARY;
  return {
    dark,
    primary,
    onPrimary: onColor(primary),
    ground: dark ? '#121211' : '#F6F6F4',
    surface: dark ? '#1A1A19' : '#FFFFFF',
    ink: dark ? '#EDEDEA' : '#141414',
    ink2: dark ? '#A8A8A2' : '#5B5B57',
    line: dark ? '#34342F' : '#E4E4E0',
    danger: dark ? '#FF8A80' : '#B42318',
  };
}
export type Theme = ReturnType<typeof useTheme>;
