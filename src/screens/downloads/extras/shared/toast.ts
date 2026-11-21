import { AccessibilityInfo, ToastAndroid } from 'react-native';

/** A short message, also announced to screen readers. */
export function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}
