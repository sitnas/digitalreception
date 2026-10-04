import { getRandomBytes } from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, ssoRedeem } from './api';
import { badgeSsoUrl, pkcePair, readReturn } from './pkce';

/**
 * "Sign in with Microsoft / Google": the system browser (shared with the phone's own sign-ins,
 * not a web view inside the app) goes to the organisation's provider and comes back to the app
 * with a one-time code, redeemed here with the verifier for the badge.
 * Returns null when the person closes the browser.
 */
export async function activateWithSso(origin: string) {
  const { verifier, challenge } = pkcePair(getRandomBytes(32));
  // drbadge://sso in the installed app, exp://…/--/sso in Expo Go.
  const returnTo = Linking.createURL('sso');
  const result = await WebBrowser.openAuthSessionAsync(badgeSsoUrl(origin, challenge, returnTo), returnTo);
  if (result.type !== 'success') return null;
  const back = readReturn(result.url);
  if ('error' in back) throw new ApiError(400, back.error);
  return ssoRedeem(origin, back.code, verifier);
}
