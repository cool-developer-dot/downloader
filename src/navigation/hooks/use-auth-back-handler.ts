import { useCallback } from 'react';

import { BACK_PRIORITY } from './back-handler-registry';
import { useAndroidBackHandler } from './use-android-back-handler';

/** Prevents Android back navigation on launch entry screens (splash, onboarding). */
export function useAuthBackHandler(enabled = true): void {
  const handleBackPress = useCallback(() => true, []);

  useAndroidBackHandler({
    enabled,
    onBackPress: handleBackPress,
    priority: BACK_PRIORITY.gate,
  });
}
