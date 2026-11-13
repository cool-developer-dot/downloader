/**
 * Custom entry: gate initial URL settlement before expo-router boots.
 * Prevents useLinking → setLastUnhandledLink before NavigationContainer mounts.
 * @see ./bootstrap/defer-initial-linking.ts
 * @see ./bootstrap/patch-expo-router-linking.ts
 * @see ./app/+native-intent.ts
 */
import './bootstrap/configure-storage';
import './bootstrap/defer-initial-linking';
import './bootstrap/patch-expo-router-linking';
// B23 #289: background tasks are defined at the top level so a headless start finds them.
import './bootstrap/define-page-alert-task';
import 'expo-router/entry';
