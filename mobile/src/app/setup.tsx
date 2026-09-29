import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { ApiError, activate, getTenant, requestCode, type Tenant } from '../lib/api';
import { isBadge, normaliseOrigin } from '../lib/badge';
import { useBadge } from '../lib/badge-context';
import { lang, t } from '../lib/i18n';
import { useTheme } from '../lib/theme';

type Step = 'org' | 'email' | 'code';

/**
 * First run: organisation address → work email → 6-digit code from the email. A link
 * drbadge://setup?org=acme.example.com (e.g. from a QR in the welcome email) fills the first step.
 */
export default function Setup() {
  const params = useLocalSearchParams<{ org?: string }>();
  const { save } = useBadge();
  const [step, setStep] = useState<Step>('org');
  const [orgInput, setOrgInput] = useState(params.org ?? '');
  const [org, setOrg] = useState<{ origin: string; tenant: Tenant } | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme(org?.tenant.primaryColor);
  const codeInput = useRef<TextInput>(null);

  useEffect(() => { if (step === 'code') codeInput.current?.focus(); }, [step]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? (t.errors as Record<string, string>)[e.code] ?? t.errors.generic : t.errors.offline);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } finally { setBusy(false); }
  };

  const submitOrg = () => run(async () => {
    const origin = normaliseOrigin(orgInput, __DEV__);
    if (!origin) { setError(t.orgInvalid); return; }
    try { setOrg({ origin, tenant: await getTenant(origin) }); setStep('email'); }
    catch (e) { setError(e instanceof ApiError ? t.orgUnreachable : t.errors.offline); }
  });
  const submitEmail = () => run(async () => {
    try { await requestCode(org!.origin, email.trim(), lang); setSent(true); setStep('code'); } catch (e) { fail(e); }
  });
  const submitCode = () => run(async () => {
    try {
      const res = await activate(org!.origin, email.trim(), code);
      const badge = { ...res, origin: org!.origin, primaryColor: org!.tenant.primaryColor };
      if (!isBadge(badge)) { setError(t.errors.generic); return; }
      await save(badge);
      router.replace('/');
    } catch (e) { fail(e); setCode(''); codeInput.current?.focus(); }
  });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>{step === 'org' ? t.orgTitle : org?.tenant.name ?? t.title}</Text>
          <Text style={[styles.intro, { color: theme.ink2 }]}>{step === 'org' ? t.orgIntro : sent ? t.sent : t.emailIntro}</Text>

          {step === 'org' ? (
            <View style={styles.form}>
              <Field label={t.orgLabel} theme={theme} error={error} value={orgInput} onChangeText={setOrgInput}
                placeholder={t.orgExample} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
                returnKeyType="next" onSubmitEditing={submitOrg} />
              <Button label={t.orgNext} theme={theme} busy={busy} onPress={submitOrg} />
            </View>
          ) : step === 'email' ? (
            <View style={styles.form}>
              <Field label={t.email} theme={theme} error={error} value={email} onChangeText={setEmail}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email"
                returnKeyType="send" onSubmitEditing={submitEmail} />
              <Button label={t.send} theme={theme} busy={busy} onPress={submitEmail} />
              <Button label={t.changeOrg} kind="ghost" theme={theme} onPress={() => { setStep('org'); setError(null); }} />
            </View>
          ) : (
            <View style={styles.form}>
              <Field label={t.code} theme={theme} error={error} value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6}
                style={styles.codeInput} returnKeyType="done" onSubmitEditing={submitCode} inputRef={codeInput} />
              <Button label={t.activate} theme={theme} busy={busy} onPress={submitCode} />
              <Button label={t.changeEmail} kind="ghost" theme={theme} onPress={() => { setStep('email'); setSent(false); setCode(''); setError(null); }} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800' },
  intro: { fontSize: 16, lineHeight: 22 },
  form: { gap: 14, marginTop: 8 },
  codeInput: { fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'], textAlign: 'center' },
});
