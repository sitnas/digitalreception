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

// A notice that arrives while the app is open is shown anyway: it is the whole point.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = 'on' | 'denied' | 'unsupported' | 'error';

export async function pushToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(KEY); } catch { return null; }
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
  let token: string;
  try {
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    // Expo Go on Android cannot receive push notifications: it needs a development or store build.
    return 'unsupported';
  }
  try {
    await pushRegister(badge, token, lang);
    await SecureStore.setItemAsync(KEY, token);
    return 'on';
  } catch (e) { return e instanceof ApiError && e.code === 'NOT_A_HOST' ? 'unsupported' : 'error'; }
}

export async function forgetPushToken() {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
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
