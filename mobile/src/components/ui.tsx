import { useEffect, useRef, type Ref } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { Theme } from '../lib/theme';
import { useReducedMotion } from './motion';

/** A press you can feel: the control shrinks a little and springs back (native driver, still with reduced motion). */
function usePressScale(to = 0.97) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (v: number) => { if (!reduced) Animated.spring(scale, { toValue: v, speed: 40, bounciness: v === 1 ? 8 : 0, useNativeDriver: true }).start(); };
  return { style: { transform: [{ scale }] }, onPressIn: () => spring(to), onPressOut: () => spring(1) };
}

export function Button({ label, onPress, theme, kind = 'primary', busy = false, disabled = false }: {
  label: string; onPress: () => void; theme: Theme; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean;
}) {
  const bg = kind === 'primary' ? theme.primary : 'transparent';
  const fg = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? theme.danger : theme.ink;
  const press = usePressScale();
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: disabled || busy }}
        disabled={disabled || busy} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'primary' ? bg : theme.line, opacity: disabled ? 0.45 : pressed ? 0.9 : 1 }]}>
        {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
      </Pressable>
    </Animated.View>
  );
}

export function Field({ label, theme, error, inputRef, ...input }: { label: string; theme: Theme; error?: string | null; inputRef?: Ref<TextInput> } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.ink }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={theme.ink2}
        style={[styles.input, { color: theme.ink, backgroundColor: theme.surface, borderColor: error ? theme.danger : theme.line }, input.style]}
      />
      {error ? <ErrorText text={error} color={theme.danger} /> : null}
    </View>
  );
}

/** An error slides in with one short shake, like on the web page; still with reduced motion. */
export function ErrorText({ text, color, style }: { text: string; color: string; style?: object }) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { fade.setValue(1); return; }
    fade.setValue(0); x.setValue(0);
    const step = (v: number) => Animated.timing(x, { toValue: v, duration: 50, easing: Easing.linear, useNativeDriver: true });
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.sequence([step(-4), step(4), step(-4), step(4), step(-2), step(0)]),
    ]).start();
  }, [text, reduced, fade, x]);
  return <Animated.Text accessibilityRole="alert" style={[styles.error, { color, opacity: fade, transform: [{ translateX: x }] }, style]}>{text}</Animated.Text>;
}

/** Title row of a secondary screen, with the way back. */
export function ScreenHeader({ title, onBack, backLabel, theme, right }: { title: string; onBack: () => void; backLabel: string; theme: Theme; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} hitSlop={12} style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
        <Text style={[styles.backText, { color: theme.ink }]}>‹ {backLabel}</Text>
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.ink }]}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

/** One of a few mutually exclusive choices (day, site, reason). */
export function Chip({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress: () => void; theme: Theme }) {
  const press = usePressScale(0.95);
  return (
    <Animated.View style={press.style}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.primary : theme.line, backgroundColor: selected ? theme.primary : theme.surface, opacity: pressed ? 0.9 : 1 }]}>
        <Text style={[styles.chipText, { color: selected ? theme.onPrimary : theme.ink }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 52 },
  back: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 16, fontWeight: '700' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  headerRight: { minWidth: 72, alignItems: 'flex-end' },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '700' },
  btn: { minHeight: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  error: { fontSize: 14, fontWeight: '700' },
});
