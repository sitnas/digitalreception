import type { Locale } from './strings';

export interface Notice { id: string; version: number; title: string; body: string }
export interface KioskConfig {
  organisation: { name: string; logo: string | null };
  device: { name: string };
  site: { name: string; countryCode: string; timezone: string };
  policy: { locales: Locale[]; defaultLocale: Locale; documentDataEnabled: boolean; documentPhotoEnabled: boolean; assetPhotosRequired: boolean };
  notices: Partial<Record<Locale, Notice>>;
  emailAvailable: boolean;
}
