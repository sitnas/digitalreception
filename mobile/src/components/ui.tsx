import type { Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { Theme } from '../lib/theme';

export function Button({ label, onPress, theme, kind = 'primary', busy = false, disabled = false }: {
  label: string; onPress: () => void; theme: Theme; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean;
}) {
  const bg = kind === 'primary' ? theme.primary : 'transparent';
  const fg = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? theme.danger : theme.ink;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'primary' ? bg : theme.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
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
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
    </View>
  );
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
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.primary : theme.line, backgroundColor: selected ? theme.primary : theme.surface, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={[styles.chipText, { color: selected ? theme.onPrimary : theme.ink }]}>{label}</Text>
    </Pressable>
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
