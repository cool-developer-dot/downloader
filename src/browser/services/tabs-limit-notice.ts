import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { translate } from '@/localization';

/** "Maximum 10 tabs open" as a toast (visible wherever the tab was asked for) and a screen-reader announcement. */
export function announceTabsLimitReached(): string {
  const message = translate('browser.tabsLimitReached');
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
  return message;
}
