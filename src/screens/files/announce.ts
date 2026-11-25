import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

/** A short message: a toast on Android, and read out by TalkBack. */
export function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}
