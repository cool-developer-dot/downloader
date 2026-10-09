import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { translate } from '@/localization';

/**
 * Tells the user a YouTube link they pasted, shared or opened with VidoraX is refused (see isYouTubeLink): a toast,
 * which shows wherever the link came from, and a screen-reader announcement. Returns the message.
 */
export function announceYouTubeNotSupported(): string {
  const message = translate('browser.youtubeNotSupported');
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.LONG);
  }
  AccessibilityInfo.announceForAccessibility(message);
  return message;
}
