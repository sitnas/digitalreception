import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, ErrorText, ScreenHeader } from '../components/ui';
import { ApiError, bookParking, cancelParking, getParking } from '../lib/api';
import { useBadge } from '../lib/badge-context';
import { lang, t } from '../lib/i18n';
import type { ParkingDay, ParkingView } from '../lib/invites';
import { useTheme } from '../lib/theme';

const locale = lang === 'en' ? 'en-GB' : lang;
const P = t.parking;
/** "giovedì 8 ottobre", in the language of the app (written as the language writes it). */
const longDay = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd, 12)));
};
const explain = (e: unknown) => (e instanceof ApiError ? (P.errors as Record<string, string>)[e.code] ?? t.errors.generic : t.errors.offline);

/** The Parking app: the days that can be booked, my bookings, my fixed spot if I am a manager. */
export default function ParkingScreen() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor, badge?.secondaryColor);
  const [view, setView] = useState<ParkingView | null>(null);
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (site = siteId) => {
    if (!badge) return;
    try { const v = await getParking(badge, site); setView(v); setError(null); }
    catch (e) { setError(explain(e)); }
  }, [badge, siteId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!badge) return null;
  const today = view?.days[0]?.date;
  const label = (d: string) => {
    if (d === today) return P.today;
    const tomorrow = today && new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1)).toISOString().slice(0, 10);
    if (d === tomorrow) return P.tomorrow;
    const text = longDay(d);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const book = async (day: ParkingDay) => {
    if (!view?.site) return;
    setBusy(day.date); setError(null); setNotice(null);
    try { const b = await bookParking(badge, view.site.id, day.date); setNotice(P.booked.replace('{spot}', b.spot)); await load(); }
    catch (e) { setError(explain(e)); await load(); } finally { setBusy(null); }
  };
  const release = (day: ParkingDay) => Alert.alert(P.releaseTitle, P.releaseText, [
    { text: t.cancel, style: 'cancel' },
    { text: day.booking?.source === 'AUTO' ? P.release : P.cancel, style: 'destructive', onPress: async () => {
      setBusy(day.date); setError(null); setNotice(null);
      try { await cancelParking(badge, day.booking!.id); await load(); } catch (e) { setError(explain(e)); } finally { setBusy(null); }
    } },
  ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={P.title} backLabel={t.settings.back} onBack={() => router.back()} theme={theme} />
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {!view && !error ? <ActivityIndicator accessibilityLabel={t.loading} color={theme.ink2} /> : null}
        {view && !view.site ? <Text style={[styles.text, { color: theme.ink2 }]}>{P.none}</Text> : null}
        {view?.site ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            {view.fixedSpot ? (
              <>
                <Text style={[styles.big, { color: theme.ink }]}>{P.fixed.replace('{spot}', view.fixedSpot.code)}</Text>
                {view.fixedSpot.note ? <Text style={[styles.text, { color: theme.ink2 }]}>{view.fixedSpot.note}</Text> : null}
                <Text style={[styles.text, { color: theme.ink2 }]}>{P.fixedHint}</Text>
              </>
            ) : (
              <>
                <Text style={[styles.text, { color: theme.ink2 }]}>{P.userHint.replace('{n}', String(view.maxActive ?? 4))}</Text>
                {view.maxActive ? <Text style={[styles.big, { color: theme.ink }]}>{P.active.replace('{n}', String(view.active)).replace('{max}', String(view.maxActive))}</Text> : null}
              </>
            )}
            {view.opensOn ? <Text style={[styles.text, { color: theme.ink2 }]}>{P.opens.replace('{date}', longDay(view.opensOn))}</Text> : null}
          </View>
        ) : null}
        {view && view.sites.length > 1 ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {view.sites.map((s) => <Chip key={s.id} label={s.name} selected={view.site?.id === s.id} theme={theme} onPress={() => { setSiteId(s.id); load(s.id); }} />)}
          </View>
        ) : null}
        {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: theme.ink }]}>{notice}</Text> : null}
        {error ? <ErrorText text={error} color={theme.danger} /> : null}
        {view?.days.map((d) => (
          <View key={d.date} style={[styles.row, { backgroundColor: theme.surface, borderColor: d.booking ? theme.primary : theme.line, borderLeftWidth: d.booking ? 4 : 1 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.day, { color: theme.ink }]}>{label(d.date)}</Text>
              <Text style={[styles.meta, { color: theme.ink2 }]}>
                {d.booking ? `${P.spot.replace('{spot}', d.booking.spot)}${d.booking.source === 'AUTO' ? ` · ${P.auto}` : ''}`
                  : !d.bookable ? P.notOpen : d.free > 0 ? P.free.replace('{n}', String(d.free)) : P.full}
              </Text>
            </View>
            {d.booking ? <Button label={d.booking.source === 'AUTO' ? P.release : P.cancel} kind="ghost" theme={theme} busy={busy === d.date} onPress={() => release(d)} />
              : d.bookable && d.free > 0 ? <Button label={P.book} theme={theme} busy={busy === d.date} disabled={busy !== null} onPress={() => book(d)} /> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  big: { fontSize: 17, fontWeight: '800' },
  text: { fontSize: 15, lineHeight: 21 },
  notice: { fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  day: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14 },
});
