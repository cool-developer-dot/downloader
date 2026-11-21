import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { translate } from '@/localization';

/** A short toast, also spoken by TalkBack. */
export function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** The design's rows whose feature does not exist yet: shown as drawn, and say so when tapped. */
export function notifyNotAvailableYet(): void {
  notify(translate('common.notAvailableYet'));
}
