import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeNfc } from '../../modules/badge-nfc';
import { ApiError, getProfile, serverClockOffsetMs } from '../lib/api';
import { qrPayload, stepAt, type Badge } from '../lib/badge';
import { useBadge } from '../lib/badge-context';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { QrRing, SquaresBand, SuccessCheck } from './motion';
import { ParcelsCard, useParcels } from './Parcels';
import { TabBar } from './TabBar';
import type { AppKey } from '../lib/invites';
import { Button } from './ui';

/** Seconds of clock difference with the server beyond which the reader may refuse the QR. */
const CLOCK_TOLERANCE_S = 20;

/**
 * While the badge is the screen in front (not while the invitations are open): screen on, full
 * brightness, no screenshots. The previous brightness comes back after.
 */
function useBadgeInFront(enabled: boolean) {
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    activateKeepAwakeAsync('badge').catch(() => {});
    preventScreenCaptureAsync('badge').catch(() => {}); // a screenshot would stop working anyway: do not invite it
    let previous: number | null = null;
    const raise = async () => {
      try { previous ??= await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(1); } catch { /* not available */ }
    };
    const restore = async () => {
      try { if (previous !== null) await Brightness.setBrightnessAsync(previous); } catch { /* not available */ }
    };
    raise();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? raise() : restore()));
    return () => {
      sub.remove(); restore();
      deactivateKeepAwake('badge').catch(() => {});
      allowScreenCaptureAsync('badge').catch(() => {});
    };
  }, [enabled]));
}

type NfcState = 'ready' | 'off' | 'dev-build' | 'none';

/**
 * Android: the phone also answers NFC readers as a card carrying the same code as the QR, but
 * only while this screen is open and the app is in front (and, by system rule, the phone unlocked).
 */
function useNfcCard(value: string, enabled: boolean): [NfcState, () => void] {
  const [state, setState] = useState<NfcState>('none');
  const latest = useRef(value);
  latest.current = value;
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    if (!BadgeNfc) { setState(__DEV__ ? 'dev-build' : 'none'); return; }
    if (!BadgeNfc.isSupported()) return;
    // Back in front (maybe after turning NFC on in the settings): answer again with the current code.
    const refresh = () => {
      const on = BadgeNfc!.isEnabled();
      setState(on ? 'ready' : 'off');
      BadgeNfc!.setPayload(on ? latest.current : null);
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
      else BadgeNfc!.setPayload(null); // app in background: stop answering readers
    });
    // Another screen in front (invitations): stop answering readers until the badge is back.
    return () => { sub.remove(); BadgeNfc!.setPayload(null); setState('none'); };
  }, [enabled]));
  // Same code as the QR, renewed every step.
  useEffect(() => { if (state === 'ready') BadgeNfc?.setPayload(value); }, [state, value]);
  return [state, () => BadgeNfc?.openSettings()];
}

/** Right after activation: a tick and a line that fade away by themselves. */
function Activated({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const fade = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const a = Animated.timing(fade, { toValue: 0, duration: 400, delay: 2200, useNativeDriver: true });
    a.start(({ finished }) => finished && setGone(true));
    return () => a.stop();
  }, [fade]);
  if (gone) return null;
  return (
    <Animated.View style={[styles.activated, { opacity: fade }]} accessibilityRole="alert" accessibilityLabel={t.activated}>
      <SuccessCheck theme={theme} size={40} />
      <Text style={[styles.activatedText, { color: theme.ink }]}>{t.activated}</Text>
    </Animated.View>
  );
}

export function BadgeScreen({ badge, justActivated = false }: { badge: Badge; justActivated?: boolean }) {
  const theme = useTheme(badge.primaryColor, badge.secondaryColor);
  const { width } = useWindowDimensions();
  // People who can be visited also invite their guests from here.
  const [canInvite, setCanInvite] = useState(false);
  // Apps of the portal on for this person; unknown (offline, older server) shows the badge as before.
  const [apps, setApps] = useState<AppKey[] | null>(null);
  const showBadge = apps === null || apps.includes('access');
  useBadgeInFront(showBadge);
  const parcels = useParcels(badge, apps === null || apps.includes('parcels'));
  // What the server says about this badge: 'stale' when another activation or the console replaced it
  // (the reader refuses the QR too), 'offline' when it cannot be reached (the QR still works).
  const [server, setServer] = useState<'ok' | 'stale' | 'offline' | null>(null);
  const { remove, setPortal } = useBadge();
  const checkServer = useCallback(() => {
    if (!badge.appToken) return;
    getProfile(badge).then((p) => { setCanInvite(p.canInvite); setApps(p.apps ?? ['reception', 'access', 'parcels']); setServer('ok'); },
      (e) => { const stale = e instanceof ApiError && e.status === 401; if (stale) setCanInvite(false); setServer(stale ? 'stale' : 'offline'); });
  }, [badge]);
  useFocusEffect(useCallback(() => {
    checkServer();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') checkServer(); });
    return () => sub.remove();
  }, [checkServer]));
  // The tab bar (here and on the other tabs) follows what the server said.
  const pieces = parcels.reduce((n, r) => n + r.pieces, 0);
  useEffect(() => { if (apps) setPortal({ apps, canInvite, parcels: pieces }); }, [apps, canInvite, pieces, setPortal]);
  const stale = server === 'stale';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const { step, left } = stepAt(now, badge.step);
  // HMAC once per step, not once per second.
  const value = useMemo(() => qrPayload(badge, step), [badge, step]);

  const [nfc, openNfcSettings] = useNfcCard(value, showBadge);
  const [clockOff, setClockOff] = useState(false);
  useEffect(() => { serverClockOffsetMs(badge.origin).then((ms) => setClockOff(ms !== null && Math.abs(ms) > CLOCK_TOLERANCE_S * 1000)); }, [badge.origin]);

  const qrSize = Math.min(width - 116, 300);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {justActivated ? <Activated theme={theme} /> : null}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <SquaresBand theme={theme} />
          <Text style={[styles.org, { color: theme.ink2 }]} accessibilityRole="header">{badge.organisation}</Text>
          <Text style={[styles.name, { color: theme.ink }]}>{badge.firstName} {badge.lastName}</Text>
          {/* Always black on white with a quiet zone: the reader camera needs contrast, also in dark mode. */}
          {/* The ring drains during the 30 seconds: it stays outside the QR's white quiet zone. */}
          {stale ? (
            <View accessibilityRole="alert" style={[styles.stale, { borderColor: theme.danger }]}>
              <Text style={[styles.staleTitle, { color: theme.danger }]}>{t.stale.title}</Text>
              <Text style={[styles.hint, { color: theme.ink }]}>{t.stale.text}</Text>
              <Button label={t.stale.action} theme={theme} onPress={() => { remove(); }} />
            </View>
          ) : null}
          {!showBadge ? <Text style={[styles.hint, { color: theme.ink2 }]}>{t.portal.noBadge}</Text> : null}
          {/* Faded when the server refuses it: the reader would refuse it as well. */}
          {showBadge ? <View style={[styles.qrBlock, stale && styles.faded]} importantForAccessibility={stale ? 'no-hide-descendants' : 'auto'}>
          <QrRing codeStep={step} left={left} step={badge.step} theme={theme}>
            <View style={styles.qrBox} accessible accessibilityLabel={t.hint}>
              <QRCode value={value} size={qrSize} color="#000000" backgroundColor="#FFFFFF" quietZone={12} ecl="M" />
            </View>
          </QrRing>
          <Text style={[styles.small, { color: theme.ink2 }]}>{t.next.replace('{n}', String(left))}</Text>
          <Text style={[styles.hint, { color: theme.ink }]}>{t.hint}</Text>
          </View> : null}
          {nfc === 'ready' ? <Text style={[styles.nfc, { color: theme.ink }]}>{t.nfcReady}</Text> : null}
          {nfc === 'dev-build' ? <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.nfcDevBuild}</Text> : null}
          {clockOff ? <Text accessibilityRole="alert" style={[styles.warn, { color: theme.danger }]}>{t.clock}</Text> : null}
        </View>
        <ParcelsCard rows={parcels} theme={theme} />
        {!badge.appToken ? (
          <View style={styles.nfcOff}>
            <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.stale.old}</Text>
            <Button label={t.stale.action} kind="ghost" theme={theme} onPress={() => { remove(); }} />
          </View>
        ) : null}
        {server === 'offline' ? <Text accessibilityRole="alert" style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.stale.offline}</Text> : null}
        {nfc === 'off' ? (
          <View style={styles.nfcOff}>
            <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.nfcOff}</Text>
            <Button label={t.nfcOpen} kind="ghost" theme={theme} onPress={openNfcSettings} />
          </View>
        ) : null}
        {/* Removing the badge lives in the settings, away from the buttons used every day. */}
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} hitSlop={12} style={({ pressed }) => [styles.settings, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.settingsText, { color: theme.ink2 }]}>{t.settings.open}</Text>
        </Pressable>
      </ScrollView>
      <TabBar active={showBadge ? 'badge' : 'home'} theme={theme} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 16, flexGrow: 1, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 20, padding: 24, alignItems: 'center', gap: 10, overflow: 'hidden' },
  activated: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  activatedText: { fontSize: 17, fontWeight: '700' },
  org: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  name: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  qrBox: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 4 },
  small: { fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  warn: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  nfc: { fontSize: 15, textAlign: 'center', fontWeight: '700' },
  nfcOff: { gap: 8 },
  stale: { alignSelf: 'stretch', borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 10 },
  staleTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  qrBlock: { alignItems: 'center', gap: 10 },
  faded: { opacity: 0.2 },
  settings: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  settingsText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
