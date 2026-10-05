import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, ErrorText, Field, ScreenHeader } from '../../components/ui';
import { ApiError, createInvite, getProfile } from '../../lib/api';
import { useBadge } from '../../lib/badge-context';
import { lang, t } from '../../lib/i18n';
import { dayOptions, isEmail, isName, normaliseTime, PURPOSES, type Profile, type Purpose } from '../../lib/invites';
import { useTheme } from '../../lib/theme';

const locale = lang === 'en' ? 'en-GB' : lang;
const QUICK_TIMES = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];

/** New invitation: the guest, when and where. The host is always the signed-in employee. */
export default function NewInviteScreen() {
  const { badge } = useBadge();
  const theme = useTheme(badge?.primaryColor);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [f, setF] = useState({ firstName: '', lastName: '', company: '', email: '', siteId: '', date: '', time: '10:00', purpose: 'MEETING' as Purpose });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'time' | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const lastRef = useRef<TextInput>(null), companyRef = useRef<TextInput>(null), emailRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!badge) return;
    getProfile(badge).then((p) => { setProfile(p); setF((x) => ({ ...x, siteId: x.siteId || p.sites[0]?.id || '' })); })
      .catch((e) => setErrors({ form: e instanceof ApiError ? t.errors.generic : t.errors.offline }));
  }, [badge]);

  const site = profile?.sites.find((s) => s.id === f.siteId) ?? profile?.sites[0];
  const days = useMemo(() => (site ? dayOptions(Date.now(), site.timezone, locale) : []), [site]);
  useEffect(() => { if (days.length && !days.some((d) => d.date === f.date)) setF((x) => ({ ...x, date: days[0].date })); }, [days, f.date]);

  if (!badge) return null;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const submit = async () => {
    const time = normaliseTime(f.time);
    const e: typeof errors = {};
    if (!isName(f.firstName) || !isName(f.lastName)) e.name = t.invites.errors.name;
    if (!isEmail(f.email)) e.email = t.invites.errors.email;
    if (!time) e.time = t.invites.errors.time;
    // No site left means this person is no longer someone who can be visited: say so instead of doing nothing.
    if (!site) e.form = t.invites.errors.NOT_A_HOST;
    setErrors(e);
    if (Object.keys(e).length || !site) return;
    setBusy(true);
    try {
      const r = await createInvite(badge, { siteId: site.id, date: f.date, time: time!, firstName: f.firstName.trim(), lastName: f.lastName.trim(), company: f.company.trim() || null, email: f.email.trim().toLowerCase(), purpose: f.purpose }, lang);
      router.replace({ pathname: '/invites/[id]', params: { id: r.id, created: r.emailStatus } });
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? (t.invites.errors[err.code as keyof typeof t.invites.errors] ?? t.errors.generic) : t.errors.offline });
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.ground }]}>
      <ScreenHeader title={t.invites.new} backLabel={t.invites.back} onBack={() => router.back()} theme={theme} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!profile ? (
          errors.form ? <ErrorText text={errors.form} color={theme.danger} style={{ margin: 20 }} /> : <ActivityIndicator style={{ marginTop: 32 }} color={theme.ink2} />
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[styles.section, { color: theme.ink2 }]}>{t.invites.guest}</Text>
            <Field label={t.invites.firstName} theme={theme} value={f.firstName} onChangeText={set('firstName')} autoComplete="off" textContentType="givenName" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => lastRef.current?.focus()} maxLength={80} />
            <Field label={t.invites.lastName} theme={theme} inputRef={lastRef} value={f.lastName} onChangeText={set('lastName')} autoComplete="off" textContentType="familyName" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => companyRef.current?.focus()} maxLength={80} error={errors.name} />
            <Field label={t.invites.company} theme={theme} inputRef={companyRef} value={f.company} onChangeText={set('company')} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} maxLength={120} />
            <Field label={t.invites.email} theme={theme} inputRef={emailRef} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="emailAddress" maxLength={190} error={errors.email} />

            <Text accessibilityRole="header" style={[styles.section, { color: theme.ink2 }]}>{t.invites.when}</Text>
            {profile.sites.length > 1 ? (
              <View style={styles.group}>
                <Text style={[styles.label, { color: theme.ink }]}>{t.invites.site}</Text>
                <View accessibilityRole="radiogroup" style={styles.wrap}>
                  {profile.sites.map((s) => <Chip key={s.id} label={s.name} selected={s.id === site?.id} onPress={() => setF({ ...f, siteId: s.id })} theme={theme} />)}
                </View>
              </View>
            ) : null}
            <View style={styles.group}>
              <Text style={[styles.label, { color: theme.ink }]}>{t.invites.day}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" contentContainerStyle={styles.row}>
                {days.map((d, i) => <Chip key={d.date} label={i === 0 ? t.invites.today : i === 1 ? t.invites.tomorrow : d.label} selected={d.date === f.date} onPress={() => setF({ ...f, date: d.date })} theme={theme} />)}
              </ScrollView>
            </View>
            <View style={styles.group}>
              <View style={styles.wrap}>
                {QUICK_TIMES.map((q) => <Chip key={q} label={q} selected={normaliseTime(f.time) === q} onPress={() => setF({ ...f, time: q })} theme={theme} />)}
              </View>
              <Field label={t.invites.time} theme={theme} value={f.time} onChangeText={set('time')} keyboardType="numbers-and-punctuation" placeholder={t.invites.timeHint} maxLength={5} error={errors.time} />
            </View>
            <View style={styles.group}>
              <Text style={[styles.label, { color: theme.ink }]}>{t.invites.purpose}</Text>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                {PURPOSES.map((p) => <Chip key={p} label={t.invites.purposes[p]} selected={f.purpose === p} onPress={() => setF({ ...f, purpose: p })} theme={theme} />)}
              </View>
            </View>

            {errors.form ? <ErrorText text={errors.form} color={theme.danger} /> : null}
            <Button label={t.invites.create} theme={theme} busy={busy} onPress={submit} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { gap: 8, paddingRight: 20 },
  error: { fontSize: 15, fontWeight: '700' },
});
