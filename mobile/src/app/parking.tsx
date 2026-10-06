import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabBar } from '../components/TabBar';
import { Button, Chip, ErrorText, ScreenHeader } from '../components/ui';
import { ApiError, bookParkingDays, cancelParking, getParking, getParkingSpots } from '../lib/api';
import { useBadge } from '../lib/badge-context';
import { lang, t } from '../lib/i18n';
import { parkingWeeks, type ParkingDay, type ParkingSpotChoice, type ParkingView } from '../lib/invites';
import { useTheme, type Theme } from '../lib/theme';

const locale = lang === 'en' ? 'en-GB' : lang;
const P = t.parking;
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd, 12)));
};
/** "giovedì 8 ottobre", in the language of the app (written as the language writes it). */
const longDay = (d: string) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
/** "gio 8 ott", for lists of days. */
const shortDay = (d: string) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
const reason = (code: string) => (P.errors as Record<string, string>)[code] ?? t.errors.generic;
const explain = (e: unknown) => (e instanceof ApiError ? reason(e.code) : t.errors.offline);

/**
 * The Parking app: a calendar of two weeks where the person picks one or more days, then the spot
 * (or the first free one), and books them in one go. A booked day is tapped to give it back.
 */
export default function ParkingScreen() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor, badge?.secondaryColor);
  const [view, setView] = useState<ParkingView | null>(null);
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string[]>([]);
  const [spots, setSpots] = useState<ParkingSpotChoice[] | null>(null);
  const [spotId, setSpotId] = useState<string | null>(null);
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

  // The spots follow the days picked: only those free on all of them can be chosen.
  const current = view?.site?.id;
  useEffect(() => {
    if (!badge || !current || !picked.length) { setSpots(null); return; }
    let live = true;
    getParkingSpots(badge, current, picked)
      .then((s) => { if (!live) return; setSpots(s); setSpotId((cur) => (cur && s.some((x) => x.id === cur && x.free) ? cur : null)); })
      .catch((e) => live && setError(explain(e)));
    return () => { live = false; };
  }, [badge, current, picked]);

  if (!badge) return null;
  const left = view?.maxActive == null ? Infinity : view.maxActive - view.active;
  const today = view?.days[0]?.date ?? '';
  const free = spots?.filter((s) => s.free) ?? [];
  const chosen = free.find((s) => s.id === spotId);

  const toggle = (day: ParkingDay) => {
    setNotice(null); setError(null);
    if (picked.includes(day.date)) { setPicked(picked.filter((d) => d !== day.date)); return; }
    if (picked.length >= left) { setError(left > 0 ? (left === 1 ? P.leftOne : P.leftMany.replace('{n}', String(left))) : reason('PARKING_LIMIT')); return; }
    setPicked([...picked, day.date].sort());
  };
  const book = async () => {
    if (!current || !picked.length) return;
    setBusy('book'); setError(null); setNotice(null);
    try {
      const r = await bookParkingDays(badge, current, picked, spotId);
      if (r.booked.length) setNotice(P.bookedDays.replace('{list}', r.booked.map((b) => P.dayOn.replace('{day}', shortDay(b.date)).replace('{spot}', b.spot)).join('; ')));
      if (r.failed.length) setError(r.failed.map((f) => P.failedDay.replace('{day}', shortDay(f.date)).replace('{reason}', reason(f.code))).join('\n'));
      setPicked([]); setSpotId(null);
    } catch (e) { setError(explain(e)); }
    finally { await load(); setBusy(null); }
  };
  const release = (day: ParkingDay) => Alert.alert(P.releaseTitle, P.releaseText, [
    { text: t.cancel, style: 'cancel' },
    { text: day.booking?.source === 'AUTO' ? P.release : P.cancel, style: 'destructive', onPress: async () => {
      setBusy(day.date); setError(null); setNotice(null);
      try { await cancelParking(badge, day.booking!.id); await load(); } catch (e) { setError(explain(e)); } finally { setBusy(null); }
    } },
  ]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={P.title} backLabel={t.settings.back} theme={theme} />
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
            {view.sites.map((s) => <Chip key={s.id} label={s.name} selected={view.site?.id === s.id} theme={theme} onPress={() => { setPicked([]); setNotice(null); setSiteId(s.id); load(s.id); }} />)}
          </View>
        ) : null}

        {view?.site ? (
          <>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.ink2 }]}>{P.pick}</Text>
            <Text style={[styles.meta, { color: theme.ink2 }]}>{P.pickHint}</Text>
            {parkingWeeks(view.days).map((w, i) => (
              <View key={w.monday} style={{ gap: 8 }}>
                <Text style={[styles.week, { color: theme.ink }]}>{i === 0 && w.monday <= today ? P.thisWeek : P.nextWeek}</Text>
                <View style={styles.grid}>
                  {w.cells.map(({ date, day }) => (
                    <DayCell key={date} date={date} day={day} theme={theme} on={picked.includes(date)} busy={busy}
                      onPress={() => (day?.booking ? release(day) : day && toggle(day))} />
                  ))}
                </View>
              </View>
            ))}
          </>
        ) : null}

        {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: theme.ink }]}>{notice}</Text> : null}
        {error ? <ErrorText text={error} color={theme.danger} /> : null}

        {picked.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.ink2 }]}>{P.spotTitle}</Text>
            <View style={{ gap: 8 }} accessibilityRole="radiogroup">
              <SpotRow theme={theme} selected={spotId === null} title={P.anySpot} note={P.anySpotHint} onPress={() => setSpotId(null)} />
              {free.length > 0 ? (
                <View style={styles.tiles}>
                  {free.map((s) => {
                    const on = spotId === s.id;
                    return (
                      <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setSpotId(s.id)}
                        accessibilityLabel={`${P.spot.replace('{spot}', s.code)}${s.note ? `, ${s.note}` : ''}`}
                        style={[styles.tile, { backgroundColor: on ? theme.primary : theme.surface, borderColor: on ? theme.primary : theme.line }]}>
                        <Text style={[styles.tileCode, { color: on ? theme.onPrimary : theme.ink }]}>{s.code}</Text>
                        {s.note ? <View style={[styles.tileDot, { backgroundColor: on ? theme.onPrimary : theme.ink2 }]} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
            {chosen?.note ? <Text style={[styles.meta, { color: theme.ink2 }]}>{P.spot.replace('{spot}', chosen.code)}: {chosen.note}</Text> : null}
            {spots && free.length === 0 ? <Text style={[styles.meta, { color: theme.ink2 }]}>{P.noCommonSpot}</Text> : null}
            <Button label={picked.length === 1 ? P.bookOne : P.bookMany.replace('{n}', String(picked.length))} theme={theme} busy={busy === 'book'} disabled={busy !== null} onPress={book} />
            <Button label={P.clear} kind="ghost" theme={theme} disabled={busy !== null} onPress={() => { setPicked([]); setSpotId(null); }} />
          </>
        ) : null}
      </ScrollView>
      <TabBar active="parking" theme={theme} />
    </SafeAreaView>
  );
}

/** One day of the calendar: past, booked (tap to give it back), open (tap to pick), closed or full. */
function DayCell({ date, day, theme, on, busy, onPress }: { date: string; day?: ParkingDay; theme: Theme; on: boolean; busy: string | null; onPress: () => void }) {
  const head = (color: string, sub: string) => (
    <>
      <Text style={[styles.cellWeekday, { color: sub }]}>{fmt(date, { weekday: 'short' })}</Text>
      <Text style={[styles.cellDay, { color }]}>{fmt(date, { day: 'numeric' })}</Text>
    </>
  );
  if (!day) {
    return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.cell, { borderColor: theme.line, borderStyle: 'dashed', opacity: 0.5 }]}>{head(theme.ink2, theme.ink2)}</View>;
  }
  if (day.booking) {
    return (
      <Pressable accessibilityRole="button" disabled={busy !== null} onPress={onPress}
        accessibilityLabel={`${longDay(date)}, ${P.spot.replace('{spot}', day.booking.spot)}. ${day.booking.source === 'AUTO' ? P.release : P.cancel}`}
        style={({ pressed }) => [styles.cell, { backgroundColor: theme.primary, borderColor: theme.primary, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
        {head(theme.onPrimary, theme.onPrimary)}
        <Text style={[styles.cellStatus, { color: theme.onPrimary, fontWeight: '800' }]}>{busy === date ? '…' : day.booking.spot}</Text>
      </Pressable>
    );
  }
  const open = day.bookable && day.free > 0;
  const status = !day.bookable ? P.closed : day.free > 0 ? P.free.replace('{n}', String(day.free)) : P.full;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on, disabled: !open }} disabled={!open || busy !== null} onPress={onPress}
      accessibilityLabel={`${longDay(date)}, ${status}${on ? `, ${P.selected}` : ''}`}
      style={({ pressed }) => [styles.cell, {
        backgroundColor: on ? `${theme.primary}33` : theme.surface, borderColor: on ? theme.ink : theme.line, borderWidth: on ? 2 : 1,
        opacity: open ? 1 : 0.5, transform: [{ scale: pressed ? 0.96 : 1 }],
      }]}>
      {head(theme.ink, on ? theme.ink : theme.ink2)}
      <Text style={[styles.cellStatus, { color: on ? theme.ink : theme.ink2 }]} numberOfLines={2}>{status}</Text>
    </Pressable>
  );
}

function SpotRow({ theme, selected, title, note, onPress }: { theme: Theme; selected: boolean; title: string; note: string | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}
      style={[styles.spot, { backgroundColor: selected ? `${theme.primary}33` : theme.surface, borderColor: selected ? theme.ink : theme.line, borderWidth: selected ? 2 : 1 }]}>
      <Text style={[styles.day, { color: theme.ink }]}>{title}</Text>
      {note ? <Text style={[styles.meta, { color: theme.ink2 }]}>{note}</Text> : null}
    </Pressable>
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
  section: { marginTop: 6, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  week: { fontSize: 15, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 2, borderWidth: 1, borderRadius: 14 },
  cellWeekday: { fontSize: 12, textTransform: 'capitalize' },
  cellDay: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cellStatus: { fontSize: 11, textAlign: 'center' },
  spot: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 2, minHeight: 56, justifyContent: 'center' },
  day: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: 64, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileCode: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  /** A dot marks the spots with a note: the note shows once the spot is chosen. */
  tileDot: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },
});
