import { requireOptionalNativeModule } from 'expo-modules-core';

interface BadgeNfcModule {
  isSupported(): boolean;
  isEnabled(): boolean;
  setPayload(payload: string | null): void;
  openSettings(): void;
}

/**
 * Phone as NFC card (Android host card emulation). null on iOS and in Expo Go, which do not
 * contain this native code: the app then offers the QR code only.
 */
export const BadgeNfc = requireOptionalNativeModule<BadgeNfcModule>('BadgeNfc');
