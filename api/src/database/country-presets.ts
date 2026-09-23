/**
 * Privacy-first starting values used when a country is added to a tenant.
 * Every value is editable afterwards by the tenant's administrator.
 */
export interface CountryPreset {
  name: string; defaultLocale: 'it' | 'es' | 'en'; locales: ('it' | 'es' | 'en')[]; visitRetentionDays: number;
  documentDataEnabled: boolean; documentPhotoEnabled: boolean; documentPhotoRetentionDays: number; assetPhotosRequired: boolean; assetPhotoRetentionDays: number;
}

const base = { documentDataEnabled: false, documentPhotoEnabled: false, documentPhotoRetentionDays: 7, assetPhotosRequired: false, assetPhotoRetentionDays: 30 };

export const COUNTRY_PRESETS: Record<string, CountryPreset> = {
  IT: { ...base, name: 'Italia', defaultLocale: 'it', locales: ['it', 'en'], visitRetentionDays: 90 },
  ES: { ...base, name: 'España', defaultLocale: 'es', locales: ['es', 'en'], visitRetentionDays: 30 },
  PE: { ...base, name: 'Perú', defaultLocale: 'es', locales: ['es', 'en'], visitRetentionDays: 90, documentDataEnabled: true, assetPhotosRequired: true },
  CO: { ...base, name: 'Colombia', defaultLocale: 'es', locales: ['es', 'en'], visitRetentionDays: 90, documentDataEnabled: true, assetPhotosRequired: true },
};

export function presetFor(countryCode: string): CountryPreset {
  return COUNTRY_PRESETS[countryCode] ?? { ...base, name: countryCode, defaultLocale: 'en', locales: ['en'], visitRetentionDays: 30 };
}
