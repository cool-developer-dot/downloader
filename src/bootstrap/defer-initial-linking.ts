/**
 * Optional soft delay for React Native Linking.getInitialURL on Android.
 *
 * Primary fix for the Expo Router mount race:
 * `src/app/+native-intent.ts` — initial `redirectSystemPath` returns a
 * Promise that settles after NavigationContainer commit. That runs after
 * `getInitialURLWithTimeout` / `getRootURL`, so it covers Expo Go cold
 * starts where Promise.race(150ms) → null → root URL would otherwise call
 * onUnhandledLinking during first render.
 *
 * Do NOT delay Linking.getInitialURL past ~150ms here: expo-router races
 * it with a 150ms timeout, and a late resolve loses the real deep link.
 *
 * Must load before `expo-router/entry`.
 */
import { Linking, Platform } from 'react-native';

if (Platform.OS === 'android') {
  const originalGetInitialURL = Linking.getInitialURL.bind(Linking);

  Linking.getInitialURL = () =>
    new Promise<string | null>((resolve) => {
      // One macrotask past the calling render turn only — keep well under
      // expo-router's 150ms getInitialURLWithTimeout race.
      setTimeout(() => {
        void originalGetInitialURL()
          .then(resolve)
          .catch(() => resolve(null));
      }, 0);
    });
}
