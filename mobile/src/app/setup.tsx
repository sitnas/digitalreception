import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { ApiError, activate, getTenant, requestCode, type Tenant } from '../lib/api';
import { isBadge, normaliseOrigin } from '../lib/badge';
import { activateWithSso } from '../lib/sso';
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

  // A known reason in plain words; otherwise the generic message plus status and code, so that
  // whoever helps the employee can tell what the server answered.
  const fail = (e: unknown) => {
    if (!(e instanceof ApiError)) { setError(t.errors.offline); return; }
    const known = (t.errors as Record<string, string>)[e.code];
    if (known) setError(known);
    else if (e.status === 429) setError(t.errors.tooMany);
    else if (e.status === 400 && /email/i.test(e.code)) setError(t.errors.invalidEmail);
    else setError(`${t.errors.generic}\n${t.errors.detail}: ${e.status} ${e.code}`);
  };
  // Autofill and keyboards can add spaces or invisible characters around the address.
  const cleanEmail = () => email.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
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
    try { await requestCode(org!.origin, cleanEmail(), lang); setSent(true); setStep('code'); } catch (e) { fail(e); }
  });
  const finish = async (res: Awaited<ReturnType<typeof activate>>) => {
    const badge = { ...res, origin: org!.origin, primaryColor: org!.tenant.primaryColor, secondaryColor: org!.tenant.secondaryColor };
    if (!isBadge(badge)) { setError(t.errors.generic); return; }
    await save(badge);
    router.replace('/?activated=1');
  };
  const submitCode = () => run(async () => {
    try { await finish(await activate(org!.origin, cleanEmail(), code)); }
    catch (e) { fail(e); setCode(''); codeInput.current?.focus(); }
  });
  // Company account: no code to wait for. null = the person closed the browser.
  const submitSso = () => run(async () => {
    try { const res = await activateWithSso(org!.origin); if (res) await finish(res); } catch (e) { fail(e); }
  });
  const sso = org?.tenant.sso;
  const providerName = sso?.provider === 'microsoft' ? 'Microsoft' : 'Google';

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
              {sso ? (
                <>
                  <Button label={t.ssoSignIn.replace('{provider}', providerName)} theme={theme} busy={busy} onPress={submitSso} />
                  <Text style={[styles.hint, { color: theme.ink2 }]}>{t.ssoHint}</Text>
                  <Text style={[styles.or, { color: theme.ink2 }]}>{t.ssoOr}</Text>
                </>
              ) : null}
              <Field label={t.email} theme={theme} error={error} value={email} onChangeText={setEmail}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email"
                returnKeyType="send" onSubmitEditing={submitEmail} />
              <Button label={t.send} kind={sso ? 'ghost' : 'primary'} theme={theme} busy={busy} onPress={submitEmail} />
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
  hint: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  or: { fontSize: 14, fontWeight: '700', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  codeInput: { fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'], textAlign: 'center' },
});
