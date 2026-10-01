import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ScreenHeader } from '../../components/ui';
import { ApiError, listInvites } from '../../lib/api';
import { useBadge } from '../../lib/badge-context';
import { lang, t } from '../../lib/i18n';
import { byDay, dateIn, timeIn, type Invite } from '../../lib/invites';
import { disablePush, enablePush, pushToken, sendTestPush } from '../../lib/push';
import { useTheme } from '../../lib/theme';

const locale = lang === 'en' ? 'en-GB' : lang;

/** Upcoming guests of the signed-in employee, by day. */
export default function InvitesScreen() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor);
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!badge) return;
    try { setRows(await listInvites(badge)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? (t.invites.errors[e.code as keyof typeof t.invites.errors] ?? t.errors.generic) : t.errors.offline); }
  }, [badge]);
  // Also after coming back from a new or cancelled invitation.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!badge) return null;
  const now = Date.now();
  const dayLabel = (date: string, tz: string) =>
    date === dateIn(now, tz) ? t.invites.today : date === dateIn(now + 86_400_000, tz) ? t.invites.tomorrow
      : new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00Z`));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={t.invites.title} backLabel={t.invites.back} onBack={() => router.back()} theme={theme} />
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Button label={t.invites.new} theme={theme} onPress={() => router.push('/invites/new')} />
        <ArrivalNotices />
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        {rows === null && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={theme.ink2} /> : null}
        {rows && rows.length === 0 ? <Text style={[styles.empty, { color: theme.ink2 }]}>{t.invites.none}</Text> : null}
        {rows && byDay(rows).map((g) => (
          <View key={g.date} style={styles.group}>
            <Text accessibilityRole="header" style={[styles.day, { color: theme.ink2 }]}>{dayLabel(g.date, g.rows[0].timezone)}</Text>
            {g.rows.map((r) => (
              <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push(`/invites/${r.id}`)}
                accessibilityLabel={`${timeIn(Date.parse(r.expectedAt), r.timezone)}, ${r.firstName} ${r.lastName}, ${t.invites.status[r.status]}`}
                style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.time, { color: theme.ink }]}>{timeIn(Date.parse(r.expectedAt), r.timezone)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: theme.ink, textDecorationLine: r.status === 'CANCELLED' ? 'line-through' : 'none' }]}>{r.firstName} {r.lastName}</Text>
                  <Text style={[styles.meta, { color: theme.ink2 }]}>{[r.company, r.siteName].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={[styles.status, { color: r.status === 'PENDING' ? theme.ink : theme.ink2 }]}>{t.invites.status[r.status]}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The switch for "your guest has arrived" on this phone, with a test button once it is on. */
function ArrivalNotices() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { pushToken().then((tk) => setOn(!!tk)); }, []);
  if (!badge || on === null) return null;

  const toggle = async (next: boolean) => {
    setBusy(true); setNote(null);
    if (next) {
      const r = await enablePush(badge);
      setOn(r === 'on');
      if (r !== 'on') setNote(r === 'denied' ? t.invites.push.denied : r === 'unsupported' ? t.invites.push.unsupported : t.errors.generic);
    } else { await disablePush(badge); setOn(false); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    setNote((await sendTestPush(badge)) === 'OK' ? t.invites.push.testSent : t.errors.generic);
    setBusy(false);
  };

  return (
    <View style={[styles.push, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={styles.pushRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: theme.ink }]}>{t.invites.push.label}</Text>
          <Text style={[styles.meta, { color: theme.ink2 }]}>{t.invites.push.hint}</Text>
        </View>
        <Switch value={on} onValueChange={toggle} disabled={busy} accessibilityLabel={t.invites.push.label} />
      </View>
      {on ? <Button label={t.invites.push.test} theme={theme} kind="ghost" busy={busy} onPress={test} /> : null}
      {note ? <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: theme.ink2 }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  push: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  screen: { flex: 1 },
  content: { padding: 20, gap: 16 },
  error: { fontSize: 15, fontWeight: '700' },
  empty: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 16 },
  group: { gap: 8 },
  day: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 64 },
  time: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 56 },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 2 },
  status: { fontSize: 13, fontWeight: '700' },
});
