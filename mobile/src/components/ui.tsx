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

const styles = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  error: { fontSize: 14, fontWeight: '700' },
});
