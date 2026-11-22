import { useCallback } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';

/** A chip, tile or row the design draws whose feature is not built yet: "Not available yet", shown and spoken. */
export function usePlayerNotYet(): () => void {
  const { t } = useTranslation();
  return useCallback(() => {
    const message = t('common.notAvailableYet');
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
    AccessibilityInfo.announceForAccessibility(message);
  }, [t]);
}

/** A short confirmation (Stopped, Jumped to 1:24): a toast, and spoken for TalkBack. */
export function announcePlayer(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}
