import * as SecureStore from 'expo-secure-store';
import { isBadge, type Badge } from './badge';

/**
 * The badge secret lives only in the device keystore (Keychain / Android Keystore), readable
 * while the phone is unlocked and never copied to backups or to another device.
 */
const KEY = 'badge.v1';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadBadge(): Promise<Badge | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isBadge(v) ? v : null;
  } catch { return null; }
}

export async function saveBadge(b: Badge): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(b), OPTIONS);
}

export async function clearBadge(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
}
