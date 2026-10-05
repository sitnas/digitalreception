import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeNfc } from '../../modules/badge-nfc';
import { getProfile, serverClockOffsetMs } from '../lib/api';
import { qrPayload, stepAt, type Badge } from '../lib/badge';
import { useBadge } from '../lib/badge-context';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { QrRing, SquaresBand, SuccessCheck } from './motion';
import { ParcelsCard } from './Parcels';
import { Button } from './ui';

/** Seconds of clock difference with the server beyond which the reader may refuse the QR. */
const CLOCK_TOLERANCE_S = 20;

/**
 * While the badge is the screen in front (not while the invitations are open): screen on, full
 * brightness, no screenshots. The previous brightness comes back after.
 */
function useBadgeInFront() {
  useFocusEffect(useCallback(() => {
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
  }, []));
}

type NfcState = 'ready' | 'off' | 'dev-build' | 'none';

/**
 * Android: the phone also answers NFC readers as a card carrying the same code as the QR, but
 * only while this screen is open and the app is in front (and, by system rule, the phone unlocked).
 */
function useNfcCard(value: string): [NfcState, () => void] {
  const [state, setState] = useState<NfcState>('none');
  const latest = useRef(value);
  latest.current = value;
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
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
  }, []));
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
  useBadgeInFront();
  // People who can be visited also invite their guests from here.
  const [canInvite, setCanInvite] = useState(false);
  useEffect(() => { if (badge.appToken) getProfile(badge).then((p) => setCanInvite(p.canInvite), () => {}); }, [badge]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const { step, left } = stepAt(now, badge.step);
  // HMAC once per step, not once per second.
  const value = useMemo(() => qrPayload(badge, step), [badge, step]);

  const [nfc, openNfcSettings] = useNfcCard(value);
  const [clockOff, setClockOff] = useState(false);
  useEffect(() => { serverClockOffsetMs(badge.origin).then((ms) => setClockOff(ms !== null && Math.abs(ms) > CLOCK_TOLERANCE_S * 1000)); }, [badge.origin]);

  const qrSize = Math.min(width - 116, 300);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {justActivated ? <Activated theme={theme} /> : null}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <SquaresBand theme={theme} />
          <Text style={[styles.org, { color: theme.ink2 }]} accessibilityRole="header">{badge.organisation}</Text>
          <Text style={[styles.name, { color: theme.ink }]}>{badge.firstName} {badge.lastName}</Text>
          {/* Always black on white with a quiet zone: the reader camera needs contrast, also in dark mode. */}
          {/* The ring drains during the 30 seconds: it stays outside the QR's white quiet zone. */}
          <QrRing codeStep={step} left={left} step={badge.step} theme={theme}>
            <View style={styles.qrBox} accessible accessibilityLabel={t.hint}>
              <QRCode value={value} size={qrSize} color="#000000" backgroundColor="#FFFFFF" quietZone={12} ecl="M" />
            </View>
          </QrRing>
          <Text style={[styles.small, { color: theme.ink2 }]}>{t.next.replace('{n}', String(left))}</Text>
          <Text style={[styles.hint, { color: theme.ink }]}>{t.hint}</Text>
          {nfc === 'ready' ? <Text style={[styles.nfc, { color: theme.ink }]}>{t.nfcReady}</Text> : null}
          {nfc === 'dev-build' ? <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.nfcDevBuild}</Text> : null}
          {clockOff ? <Text accessibilityRole="alert" style={[styles.warn, { color: theme.danger }]}>{t.clock}</Text> : null}
        </View>
        <ParcelsCard badge={badge} theme={theme} />
        {canInvite ? <Button label={t.invites.open} theme={theme} onPress={() => router.push('/invites')} /> : null}
        {!badge.appToken ? <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.invites.reactivate}</Text> : null}
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
  settings: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  settingsText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
