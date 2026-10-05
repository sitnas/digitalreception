import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, ScreenHeader } from '../components/ui';
import { ApiError, getProfile } from '../lib/api';
import { useBadge } from '../lib/badge-context';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';

/**
 * What this phone holds, and the way to remove the badge: kept off the badge screen so it is not
 * pressed by mistake. The organisation can leave the removal to the console only.
 */
type Removal = 'loading' | 'allowed' | 'locked' | 'revoked' | 'offline';

export default function SettingsScreen() {
  const { badge, remove } = useBadge();
  const theme = useTheme(badge?.primaryColor, badge?.secondaryColor);
  const [removal, setRemoval] = useState<Removal>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!badge) return;
    // Badges activated before the app token existed: nothing to ask, the phone just forgets it.
    if (!badge.appToken) { setRemoval('allowed'); return; }
    setRemoval('loading');
    try { setRemoval((await getProfile(badge)).canRemove === false ? 'locked' : 'allowed'); }
    // Turned off from the console (or the person left): a dead badge can always be cleared.
    catch (e) { setRemoval(e instanceof ApiError && e.status === 401 ? 'revoked' : 'offline'); }
  }, [badge]);
  useEffect(() => { check(); }, [check]);

  if (!badge) return null;
  const doRemove = async () => {
    setBusy(true); setError(null);
    try { await remove(); router.replace('/'); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'SELF_REMOVE_DISABLED') { setError(t.settings.SELF_REMOVE_DISABLED); setRemoval('locked'); }
      else setError(t.settings.offline);
    } finally { setBusy(false); }
  };
  const confirm = () => Alert.alert(t.removeTitle, t.removeText, [
    { text: t.cancel, style: 'cancel' },
    { text: t.removeConfirm, style: 'destructive', onPress: doRemove },
  ]);
  const host = badge.origin.replace(/^https?:\/\//, '');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={t.settings.title} backLabel={t.settings.back} onBack={() => router.back()} theme={theme} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <Row label={t.settings.org} value={badge.organisation} theme={theme} />
          <Row label={t.settings.person} value={`${badge.firstName} ${badge.lastName}`} theme={theme} />
          <Row label={t.settings.address} value={host} theme={theme} last />
        </View>
        {removal === 'loading' ? <ActivityIndicator accessibilityLabel={t.loading} color={theme.ink2} /> : null}
        {removal === 'locked' ? <Text style={[styles.text, { color: theme.ink2 }]}>{t.settings.locked}</Text> : null}
        {removal === 'offline' ? (
          <View style={styles.block}>
            <Text style={[styles.text, { color: theme.ink2 }]}>{t.settings.offline}</Text>
            <Button label={t.settings.retry} kind="ghost" theme={theme} onPress={check} />
          </View>
        ) : null}
        {removal === 'allowed' || removal === 'revoked' ? (
          <View style={styles.block}>
            <Text style={[styles.text, { color: theme.ink2 }]}>{removal === 'revoked' ? t.settings.revoked : t.settings.removeIntro}</Text>
            <Button label={t.remove} kind="danger" theme={theme} busy={busy} onPress={confirm} />
          </View>
        ) : null}
        {error ? <ErrorText text={error} color={theme.danger} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, theme, last = false }: { label: string; value: string; theme: ReturnType<typeof useTheme>; last?: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line }]}>
      <Text style={[styles.label, { color: theme.ink2 }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.ink }]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 20 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16 },
  row: { paddingVertical: 12, gap: 2 },
  label: { fontSize: 13, fontWeight: '600' },
  value: { fontSize: 16 },
  block: { gap: 12 },
  text: { fontSize: 15, lineHeight: 21 },
});
