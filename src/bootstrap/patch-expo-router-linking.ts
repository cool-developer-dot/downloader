/**
 * Patch expo-router's linking.getInitialURL so the Promise that feeds
 * useLinking → onUnhandledLinking cannot settle during NavigationContainer's
 * first render (React 19 / Fabric mount warning).
 *
 * Why RN Linking.getInitialURL alone is not enough:
 * Android getInitialURLWithTimeout races a 150ms timeout; on timeout (or
 * Expo Go root fallback) link/linking.js still resolves a string URL in the
 * outer .then and useLinking setStates before the fiber commits.
 *
 * Why this wraps expo-router's export (not only RN Linking):
 * `useStore` early-invokes `linking.getInitialURL()` during ContextNavigator
 * render and getLinkingConfig caches the Promise. Settlement must wait until
 * after NavigationContainerInner can commit (see afterNavigationContainerReady).
 *
 * Mutate the CJS export before `expo-router/entry` constructs the root.
 * Do not edit node_modules.
 */
import { Platform } from 'react-native';

import { afterNavigationContainerReady } from './after-navigation-ready';

type InitialURL = string | null | undefined;
type GetInitialURL = () => InitialURL | Promise<InitialURL>;

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const linking = require('expo-router/build/link/linking') as {
    getInitialURL: GetInitialURL;
  };

  const originalGetInitialURL = linking.getInitialURL.bind(linking);

  linking.getInitialURL = (): Promise<InitialURL> => {
    const result = originalGetInitialURL();
    return Promise.resolve(result).then(async (url) => {
      await afterNavigationContainerReady();
      return url;
    });
  };
}
