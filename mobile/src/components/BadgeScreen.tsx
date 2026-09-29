import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeNfc } from '../../modules/badge-nfc';
import { serverClockOffsetMs } from '../lib/api';
import { qrPayload, stepAt, type Badge } from '../lib/badge';
import { useBadge } from '../lib/badge-context';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { Button } from './ui';

/** Seconds of clock difference with the server beyond which the reader may refuse the QR. */
const CLOCK_TOLERANCE_S = 20;

/** Full brightness while the badge is on screen and the app is in front; the previous level comes back after. */
function useFullBrightness() {
  useEffect(() => {
    let previous: number | null = null;
    const raise = async () => {
      try { previous ??= await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(1); } catch { /* not available */ }
    };
    const restore = async () => {
      try { if (previous !== null) await Brightness.setBrightnessAsync(previous); } catch { /* not available */ }
    };
    raise();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? raise() : restore()));
    return () => { sub.remove(); restore(); };
  }, []);
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
  useEffect(() => {
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
    return () => { sub.remove(); BadgeNfc!.setPayload(null); };
  }, []);
  // Same code as the QR, renewed every step.
  useEffect(() => { if (state === 'ready') BadgeNfc?.setPayload(value); }, [state, value]);
  return [state, () => BadgeNfc?.openSettings()];
}

export function BadgeScreen({ badge }: { badge: Badge }) {
  const theme = useTheme(badge.primaryColor);
  const { remove } = useBadge();
  const { width } = useWindowDimensions();
  useKeepAwake();
  usePreventScreenCapture(); // a screenshot would stop working anyway: do not invite it
  useFullBrightness();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const { step, left } = stepAt(now, badge.step);
  // HMAC once per step, not once per second.
  const value = useMemo(() => qrPayload(badge, step), [badge, step]);

  const [nfc, openNfcSettings] = useNfcCard(value);
  const [clockOff, setClockOff] = useState(false);
  useEffect(() => { serverClockOffsetMs(badge.origin).then((ms) => setClockOff(ms !== null && Math.abs(ms) > CLOCK_TOLERANCE_S * 1000)); }, [badge.origin]);

  const qrSize = Math.min(width - 96, 300);
  const confirmRemove = () => Alert.alert(t.removeTitle, t.removeText, [
    { text: t.cancel, style: 'cancel' },
    { text: t.removeConfirm, style: 'destructive', onPress: () => { remove(); } },
  ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <Text style={[styles.org, { color: theme.ink2 }]} accessibilityRole="header">{badge.organisation}</Text>
          <Text style={[styles.name, { color: theme.ink }]}>{badge.firstName} {badge.lastName}</Text>
          {/* Always black on white with a quiet zone: the reader camera needs contrast, also in dark mode. */}
          <View style={styles.qrBox} accessible accessibilityLabel={t.hint}>
            <QRCode value={value} size={qrSize} color="#000000" backgroundColor="#FFFFFF" quietZone={12} ecl="M" />
          </View>
          <View style={[styles.timer, { backgroundColor: theme.line }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.timerBar, { width: `${(left / badge.step) * 100}%`, backgroundColor: theme.primary }]} />
          </View>
          <Text style={[styles.small, { color: theme.ink2 }]}>{t.next.replace('{n}', String(left))}</Text>
          <Text style={[styles.hint, { color: theme.ink }]}>{t.hint}</Text>
          {nfc === 'ready' ? <Text style={[styles.nfc, { color: theme.ink }]}>{t.nfcReady}</Text> : null}
          {nfc === 'dev-build' ? <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.nfcDevBuild}</Text> : null}
          {clockOff ? <Text accessibilityRole="alert" style={[styles.warn, { color: theme.danger }]}>{t.clock}</Text> : null}
        </View>
        {nfc === 'off' ? (
          <View style={styles.nfcOff}>
            <Text style={[styles.small, { color: theme.ink2, textAlign: 'center' }]}>{t.nfcOff}</Text>
            <Button label={t.nfcOpen} kind="ghost" theme={theme} onPress={openNfcSettings} />
          </View>
        ) : null}
        <Button label={t.remove} kind="ghost" theme={theme} onPress={confirmRemove} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 16, flexGrow: 1, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 20, padding: 24, alignItems: 'center', gap: 10 },
  org: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  name: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  qrBox: { marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 4 },
  timer: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  timerBar: { height: 6, borderRadius: 3 },
  small: { fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  warn: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  nfc: { fontSize: 15, textAlign: 'center', fontWeight: '700' },
  nfcOff: { gap: 8 },
});
