import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

/** B20: a short confirmation — a toast, and the same words for TalkBack. */
export function announceProfileMessage(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}
