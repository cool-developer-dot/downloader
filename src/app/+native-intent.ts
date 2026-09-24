/**
 * Expo Router native-intent hook.
 *
 * Defense-in-depth for the NavigationContainer mount race (also gated in
 * `bootstrap/patch-expo-router-linking.ts`). Initial paths settle after the
 * first post-commit frame so useLinking cannot setState mid-mount.
 *
 * Web links are not routes. VidoraX receives every http(s) link it is chosen
 * for (the default-browser role), and the incoming-link service already loads
 * those into the active browser tab. Handed to the router as well, such a link
 * matched no route, so `+not-found` redirected to the browser and a second copy
 * of the whole app (browser, detector, "Video available" bar) was stacked on top
 * of the first — one more for every link. Those copies raced each other's media
 * verification until the app was restarted.
 *
 * Official contract: may return Promise<string | null>; null means "not a route".
 * @see https://docs.expo.dev/router/advanced/native-intent/
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { afterNavigationContainerReady } from '@/bootstrap/after-navigation-ready';
import { isBrowserWebLink } from '@/browser/services/incoming-link';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null | Promise<string | null> {
  if (Platform.OS === 'web') {
    return path;
  }

  if (isBrowserWebLink(path)) {
    // A launch by a web link starts the app exactly like a normal launch (the root URL expo-router uses when there
    // is no deep link); the browser then opens the link itself.
    return initial ? afterNavigationContainerReady().then(() => Linking.createURL('/')) : null;
  }

  if (!initial) {
    return path;
  }

  return afterNavigationContainerReady().then(() => path);
}
