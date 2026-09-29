import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BadgeProvider } from '../lib/badge-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <BadgeProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </BadgeProvider>
    </SafeAreaProvider>
  );
}
