import { useColorScheme } from 'react-native';
import { onColor } from './color';

const DEFAULT_PRIMARY = '#FFD60A';

export function useTheme(primaryColor?: string | null, secondaryColor?: string | null) {
  const dark = useColorScheme() === 'dark';
  const primary = primaryColor && /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_PRIMARY;
  return {
    dark,
    primary,
    /** The organisation's second colour, when it has a valid one (used by the twinkling squares). */
    secondary: secondaryColor && /^#[0-9A-Fa-f]{6}$/.test(secondaryColor) ? secondaryColor : null,
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
