import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

/** B23: a short notice from a menu action (toast + screen reader). */
export function announceMenuNotice(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}
