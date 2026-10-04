import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiError, pushRegister, pushTest, pushUnregister } from './api';
import type { Badge } from './badge';
import { lang } from './i18n';

/**
 * "Your guest has arrived" on this phone. The app asks for permission only when the employee turns it
 * on, sends its Expo push token to the server and keeps it to turn it off again (or when the badge goes).
 */
const KEY = 'push.token.v1';
// Same keychain rule as the badge: readable while unlocked, never moved to another device.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// A notice that arrives while the app is open is shown anyway: it is the whole point.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = 'on' | 'denied' | 'unsupported' | 'error';

async function currentToken(): Promise<string | null> {
  try {
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch { return null; }
}

export async function pushToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(KEY, OPTIONS); } catch { return null; }
}

export async function enablePush(badge: Pick<Badge, 'origin' | 'appToken'>): Promise<PushResult> {
  // Simulators have no push token.
  if (!Device.isDevice) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('arrivals', { name: 'Ospiti arrivati', importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  // Expo Go on Android cannot receive push notifications: it needs a development or store build.
  const token = await currentToken();
  if (!token) return 'unsupported';
  try {
    await pushRegister(badge, token, lang);
    await SecureStore.setItemAsync(KEY, token, OPTIONS);
    return 'on';
  } catch (e) { return e instanceof ApiError && e.code === 'NOT_A_HOST' ? 'unsupported' : 'error'; }
}

export async function forgetPushToken() {
  await SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => {});
}

/** Best effort: the server also forgets the phone when the badge is revoked or activated elsewhere. */
export async function disablePush(badge: Pick<Badge, 'origin' | 'appToken'>) {
  const token = await pushToken();
  if (!token) return;
  try { await pushUnregister(badge, token); } catch { /* offline: the server drops it when the badge goes */ }
  await forgetPushToken();
}

export async function sendTestPush(badge: Pick<Badge, 'origin' | 'appToken'>) {
  const token = await pushToken();
  if (!token) return 'error';
  try { return (await pushTest(badge, token)).result; } catch { return 'error'; }
}

/**
 * At every start, when the notices are on: tell the server the phone's current token. Expo tokens can
 * change (reinstall, restore) and the server may have dropped one the push service refused; sending
 * it again costs one request and is harmless. Permission withdrawn in the settings → turn off.
 */
export async function syncPush(badge: Pick<Badge, 'origin' | 'appToken'>) {
  const stored = await pushToken();
  if (!stored || !badge.appToken) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') { await disablePush(badge); return; }
    const token = await currentToken();
    if (!token) return;
    if (token !== stored) await pushUnregister(badge, stored).catch(() => {});
    await pushRegister(badge, token, lang);
    if (token !== stored) await SecureStore.setItemAsync(KEY, token, OPTIONS);
  } catch (e) {
    // No longer someone who can be visited, or the badge was revoked: the switch goes off.
    if (e instanceof ApiError && (e.status === 401 || e.code === 'NOT_A_HOST')) await forgetPushToken();
  }
}
