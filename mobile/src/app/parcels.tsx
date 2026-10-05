import { router } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { parcelLine, useParcels } from '../components/Parcels';
import { ScreenHeader } from '../components/ui';
import { useBadge } from '../lib/badge-context';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';

/** The Parcels app: what is waiting at reception for this person. */
export default function ParcelsScreen() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor, badge?.secondaryColor);
  const [tick, setTick] = useState(0);
  if (!badge) return null;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={t.portal.parcels} backLabel={t.settings.back} onBack={() => router.back()} theme={theme} />
      <List key={tick} onRefresh={() => setTick((n) => n + 1)} />
    </SafeAreaView>
  );
}

function List({ onRefresh }: { onRefresh: () => void }) {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor, badge?.secondaryColor);
  const rows = useParcels(badge!, true);
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
      {rows.length === 0 ? <Text style={[styles.empty, { color: theme.ink2 }]}>{t.portal.parcelsEmpty}</Text> : null}
      {rows.map((r) => (
        <View key={r.id} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <Text style={[styles.title, { color: theme.ink }]}>{r.pieces > 1 ? t.parcels.many.replace('{n}', String(r.pieces)) : t.parcels.one}</Text>
          <Text style={[styles.meta, { color: theme.ink2 }]}>{parcelLine(r)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 12 },
  empty: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 24 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 14 },
});
