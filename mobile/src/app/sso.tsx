import { router } from 'expo-router';
import { useEffect } from 'react';

/**
 * drbadge://sso?code=… lands here on Android while the setup screen, still open underneath, reads the
 * same address from the browser session. Nothing to show: go back to it.
 */
export default function SsoReturn() {
  useEffect(() => { if (router.canGoBack()) router.back(); else router.replace('/'); }, []);
  return null;
}
