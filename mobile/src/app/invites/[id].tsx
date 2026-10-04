import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SuccessCheck } from '../../components/motion';
import { Button, ScreenHeader } from '../../components/ui';
import { ApiError, cancelInvite, inviteQr, listInvites } from '../../lib/api';
import { useBadge } from '../../lib/badge-context';
import { lang, t } from '../../lib/i18n';
import { shareText, type Invite } from '../../lib/invites';
import { useTheme } from '../../lib/theme';

const locale = lang === 'en' ? 'en-GB' : lang;

/** One invitation: the QR and code to forward, and the way to cancel it. */
export default function InviteScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor);
  const { width } = useWindowDimensions();
  const [inv, setInv] = useState<Invite | null | undefined>(undefined);
  const [qr, setQr] = useState<{ code: string; payload: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const explain = (e: unknown) => setError(e instanceof ApiError ? (t.invites.errors[e.code as keyof typeof t.invites.errors] ?? t.errors.generic) : t.errors.offline);
  const load = useCallback(async () => {
    if (!badge) return;
    try {
      const row = (await listInvites(badge)).find((r) => r.id === id) ?? (await listInvites(badge, 'past')).find((r) => r.id === id) ?? null;
      setInv(row);
      setQr(row?.status === 'PENDING' ? await inviteQr(badge, row.id) : null);
    } catch (e) { explain(e); }
  }, [badge, id]);
  useEffect(() => { load(); }, [load]);

  if (!badge) return null;
  const when = inv ? new Intl.DateTimeFormat(locale, { timeZone: inv.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(inv.expectedAt)) : '';

  const share = () => inv && qr && Share.share({
    message: shareText(t.invites.shareText, { firstName: inv.firstName, when, site: inv.siteName, organisation: badge.organisation, code: qr.code, host: badge.firstName }),
  });
  const cancel = () => Alert.alert(t.invites.cancelTitle, t.invites.cancelText, [
    { text: t.invites.keep, style: 'cancel' },
    {
      text: t.invites.cancelConfirm, style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await cancelInvite(badge, inv!.id); await load(); } catch (e) { explain(e); } finally { setBusy(false); }
      },
    },
  ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={t.invites.title} backLabel={t.invites.back} onBack={() => (router.canGoBack() ? router.back() : router.replace('/invites'))} theme={theme} />
      <ScrollView contentContainerStyle={styles.content}>
        {created ? (
          <View accessibilityRole="alert" style={[styles.notice, styles.noticeRow, { borderColor: theme.primary, backgroundColor: theme.surface }]}>
            <SuccessCheck theme={theme} size={44} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.noticeTitle, { color: theme.ink }]}>{t.invites.created}</Text>
              <Text style={[styles.meta, { color: theme.ink2 }]}>{created === 'SKIPPED' ? t.invites.emailOff : t.invites.emailSent}</Text>
            </View>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        {inv === undefined && !error ? <ActivityIndicator style={{ marginTop: 32 }} color={theme.ink2} /> : null}
        {inv ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <Text style={[styles.status, { color: theme.ink2 }]}>{t.invites.status[inv.status]}</Text>
            <Text style={[styles.name, { color: theme.ink }]}>{inv.firstName} {inv.lastName}</Text>
            {inv.company ? <Text style={[styles.meta, { color: theme.ink2 }]}>{inv.company}</Text> : null}
            <Text style={[styles.when, { color: theme.ink }]}>{when}</Text>
            <Text style={[styles.meta, { color: theme.ink2 }]}>{inv.siteName} · {t.invites.purposes[inv.purpose]}</Text>
            <Text style={[styles.meta, { color: theme.ink2 }]}>{inv.email}</Text>
            {qr ? (
              <>
                <View style={styles.qrBox} accessible accessibilityLabel={`${t.invites.code} ${qr.code.split('').join(' ')}`}>
                  <QRCode value={qr.payload} size={Math.min(width - 120, 220)} color="#000000" backgroundColor="#FFFFFF" quietZone={10} ecl="M" />
                </View>
                <Text style={[styles.meta, { color: theme.ink2 }]}>{t.invites.code}</Text>
                <Text selectable style={[styles.code, { color: theme.ink }]}>{qr.code}</Text>
              </>
            ) : null}
          </View>
        ) : null}
        {inv && qr ? <Button label={t.invites.share} theme={theme} onPress={share} /> : null}
        {inv?.status === 'PENDING' ? <Button label={t.invites.cancel} kind="danger" theme={theme} busy={busy} onPress={cancel} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14 },
  notice: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 14, gap: 4 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  noticeTitle: { fontSize: 16, fontWeight: '800' },
  error: { fontSize: 15, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 20, padding: 22, alignItems: 'center', gap: 6 },
  status: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  name: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  when: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  meta: { fontSize: 15, textAlign: 'center' },
  qrBox: { marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 4 },
  code: { fontSize: 26, fontWeight: '800', letterSpacing: 4, fontVariant: ['tabular-nums'] },
});
