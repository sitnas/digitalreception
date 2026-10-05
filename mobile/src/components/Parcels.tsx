import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, View } from 'react-native';
import { listParcels, type Parcel } from '../lib/api';
import type { Badge } from '../lib/badge';
import { lang, t } from '../lib/i18n';
import type { Theme } from '../lib/theme';
import { useReducedMotion } from './motion';

const REFRESH_MS = 60_000;

const locale = lang === 'en' ? 'en-GB' : lang;
/** When it arrived, in the site's time zone: the time if today, otherwise the day (Intl.DateTimeFormat works on Hermes). */
function arrived(r: Parcel) {
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const at = Date.parse(r.receivedAt);
  return day(at) === day(Date.now())
    ? t.parcels.today.replace('{site}', r.siteName).replace('{time}', new Intl.DateTimeFormat(locale, { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(at)))
    : t.parcels.day.replace('{site}', r.siteName).replace('{date}', new Intl.DateTimeFormat(locale, { timeZone: r.timezone, day: 'numeric', month: 'long' }).format(new Date(at)));
}

/**
 * Parcels waiting at reception, under the badge card: refreshed when the badge comes back in front
 * and once a minute while it stays there. Nothing is shown when there are none.
 */
export function ParcelsCard({ badge, theme }: { badge: Badge; theme: Theme }) {
  const [rows, setRows] = useState<Parcel[]>([]);
  const load = useCallback(() => { if (badge.appToken) listParcels(badge).then(setRows, () => {}); }, [badge]);
  useFocusEffect(useCallback(() => {
    load();
    const h = setInterval(load, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => { clearInterval(h); sub.remove(); };
  }, [load]));

  // Slides in when a parcel appears.
  const reduced = useReducedMotion();
  const appear = useRef(new Animated.Value(0)).current;
  const shown = rows.length > 0;
  useEffect(() => {
    if (!shown) { appear.setValue(0); return; }
    if (reduced) { appear.setValue(1); return; }
    Animated.spring(appear, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start();
  }, [shown, reduced, appear]);
  if (!shown) return null;

  const total = rows.reduce((n, r) => n + r.pieces, 0);
  return (
    <Animated.View accessibilityRole="summary" accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.primary, opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <Text style={[styles.title, { color: theme.ink }]}>{total > 1 ? t.parcels.many.replace('{n}', String(total)) : t.parcels.one}</Text>
      {rows.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={[styles.meta, { color: theme.ink2 }]}>
            {[r.carrier, r.pieces > 1 ? t.parcels.pieces.replace('{n}', String(r.pieces)) : null, arrived(r)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 14, padding: 14, gap: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row' },
  meta: { fontSize: 14 },
});
