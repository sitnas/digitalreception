import { Redirect, useLocalSearchParams } from 'expo-router';
import { BadgeScreen } from '../components/BadgeScreen';
import { useBadge } from '../lib/badge-context';

export default function Index() {
  const { badge } = useBadge();
  const { activated } = useLocalSearchParams<{ activated?: string }>();
  if (badge === undefined) return null; // reading the keystore: a few milliseconds
  if (!badge) return <Redirect href="/setup" />;
  return <BadgeScreen badge={badge} justActivated={activated === '1'} />;
}
