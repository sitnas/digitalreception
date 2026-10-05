import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useBadge } from '../lib/badge-context';
import { activePill } from '../lib/color';
import { t } from '../lib/i18n';
import type { Theme } from '../lib/theme';

export type TabKey = 'badge' | 'home' | 'invites' | 'parcels' | 'parking';
const ROUTES = { invites: '/invites', parcels: '/parcels', parking: '/parking' } as const;

function Icon({ name, color }: { name: TabKey; color: string }) {
  const p = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      {name === 'badge' && <>
        <Rect x={3.5} y={3.5} width={7} height={7} rx={1.5} {...p} /><Rect x={13.5} y={3.5} width={7} height={7} rx={1.5} {...p} />
        <Rect x={3.5} y={13.5} width={7} height={7} rx={1.5} {...p} /><Path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14v1" {...p} />
      </>}
      {name === 'home' && <Path d="M4 10.5L12 4l8 6.5V20H4z" {...p} />}
      {name === 'invites' && <><Circle cx={9} cy={8} r={3.5} {...p} /><Path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18.5 8v6M15.5 11h6" {...p} /></>}
      {name === 'parcels' && <><Path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" {...p} /><Path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" {...p} /></>}
      {name === 'parking' && <><Rect x={3.5} y={3.5} width={17} height={17} rx={3} {...p} /><Path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" {...p} /></>}
    </Svg>
  );
}

/**
 * Bottom tab bar (Mortise mobile navigation: three to five destinations, always in reach): the badge,
 * then the apps this person has. Hidden with a single destination. Every tab carries its label and the
 * active one is a filled pill, so it reads by shape and not only by colour. Tabs do not pile up: the
 * back gesture from any tab goes to the badge.
 */
export function TabBar({ active, theme }: { active: TabKey; theme: Theme }) {
  const { badge, portal } = useBadge();
  const insets = useSafeAreaInsets();
  if (!badge) return null;
  const apps = portal?.apps ?? null;
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    apps === null || apps.includes('access') ? { key: 'badge', label: t.portal.badge } : { key: 'home', label: t.portal.home },
    ...(portal?.canInvite ? [{ key: 'invites' as const, label: t.portal.invites }] : []),
    ...(apps?.includes('parcels') ? [{ key: 'parcels' as const, label: t.portal.parcels, count: portal?.parcels }] : []),
    ...(apps?.includes('parking') ? [{ key: 'parking' as const, label: t.parking.tile }] : []),
  ];
  if (tabs.length < 2) return null;
  const pill = activePill(theme.primary, badge.secondaryColor);
  const first = active === 'badge' || active === 'home';

  const select = (k: TabKey) => {
    if (k === active) return;
    if (k === 'badge' || k === 'home') { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    if (first) router.push(ROUTES[k]); else router.replace(ROUTES[k]);
  };

  return (
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: theme.surface, borderTopColor: theme.line, paddingBottom: Math.max(insets.bottom, 6) }]}>
      {tabs.map((tab) => {
        const on = tab.key === active;
        const color = on ? pill.fg : theme.ink2;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={tab.count ? `${tab.label}, ${tab.count}` : tab.label} onPress={() => select(tab.key)} style={styles.tab}>
            <View style={[styles.pill, on && { backgroundColor: pill.bg }]}>
              <Icon name={tab.key} color={color} />
              <Text numberOfLines={1} style={[styles.label, { color }]}>{tab.label}</Text>
            </View>
            {tab.count ? (
              <View style={[styles.count, { backgroundColor: theme.primary, borderColor: theme.surface }]}><Text style={[styles.countText, { color: theme.onPrimary }]}>{tab.count}</Text></View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4, paddingTop: 6, paddingHorizontal: 8, borderTopWidth: 1.5 },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  pill: { alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, maxWidth: '100%' },
  label: { fontSize: 12, fontWeight: '600' },
  count: { position: 'absolute', top: 2, left: '55%', minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countText: { fontSize: 11, fontWeight: '800' },
});
