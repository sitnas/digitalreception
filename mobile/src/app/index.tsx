import { Redirect } from 'expo-router';
import { BadgeScreen } from '../components/BadgeScreen';
import { useBadge } from '../lib/badge-context';

export default function Index() {
  const { badge } = useBadge();
  if (badge === undefined) return null; // reading the keystore: a few milliseconds
  if (!badge) return <Redirect href="/setup" />;
  return <BadgeScreen badge={badge} />;
}
