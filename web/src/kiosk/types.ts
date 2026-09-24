import type { Locale } from './strings';

export interface Notice { id: string; version: number; title: string; body: string }
export interface KioskHost { id: string; firstName: string; lastName: string; department: string | null; jobTitle: string | null }
export interface KioskConfig {
  organisation: { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null };
  device: { name: string };
  site: { name: string; countryCode: string; timezone: string };
  policy: { locales: Locale[]; defaultLocale: Locale; documentDataEnabled: boolean; documentPhotoEnabled: boolean; assetPhotosRequired: boolean };
  notices: Partial<Record<Locale, Notice>>;
  /** Directory of people who can be visited at this site; empty = free-text host. */
  hosts: KioskHost[];
  emailAvailable: boolean;
}
