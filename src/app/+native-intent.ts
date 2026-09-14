/**
 * Expo Router native-intent hook.
 *
 * Defense-in-depth for the NavigationContainer mount race (also gated in
 * `bootstrap/patch-expo-router-linking.ts`). Initial paths settle after the
 * first post-commit frame so useLinking cannot setState mid-mount.
 *
 * Official contract: may return Promise<string>.
 * @see https://docs.expo.dev/router/advanced/native-intent/
 */
import { Platform } from 'react-native';

import { afterNavigationContainerReady } from '@/bootstrap/after-navigation-ready';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | Promise<string> {
  if (!initial || Platform.OS === 'web') {
    return path;
  }

  return afterNavigationContainerReady().then(() => path);
}
