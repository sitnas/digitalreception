import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../lib/theme';
import { usePressScale } from './ui';

export interface Tile { key: string; label: string; detail: string; onPress: () => void; badge?: number }

/** The apps of the organisation this person can open, as a grid of tiles under the badge. */
export function AppTiles({ title, tiles, theme }: { title: string; tiles: Tile[]; theme: Theme }) {
  if (!tiles.length) return null;
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.ink2 }]}>{title}</Text>
      <View style={styles.grid}>{tiles.map((tile) => <AppTile key={tile.key} tile={tile} theme={theme} />)}</View>
    </View>
  );
}

function AppTile({ tile, theme }: { tile: Tile; theme: Theme }) {
  const press = usePressScale(0.97);
  return (
    <Animated.View style={[styles.cell, press.style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${tile.label}, ${tile.detail}`} onPress={tile.onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={[styles.bar, { backgroundColor: theme.primary }]} />
        <Text style={[styles.label, { color: theme.ink }]}>{tile.label}</Text>
        <Text style={[styles.detail, { color: theme.ink2 }]}>{tile.detail}</Text>
        {tile.badge ? (
          <View style={[styles.count, { backgroundColor: theme.primary }]}><Text style={[styles.countText, { color: theme.onPrimary }]}>{tile.badge}</Text></View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: { fontSize: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: '45%' },
  tile: { borderWidth: 1, borderRadius: 16, padding: 16, paddingTop: 20, gap: 4, minHeight: 104, overflow: 'hidden' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  label: { fontSize: 17, fontWeight: '800' },
  detail: { fontSize: 14, lineHeight: 19 },
  count: { position: 'absolute', top: 14, right: 14, minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { fontSize: 14, fontWeight: '800' },
});
