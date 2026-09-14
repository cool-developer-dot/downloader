import { Linking } from 'react-native';

/**
 * Opens an external URL safely. Never throws — callers handle UX on false.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const canOpen = await Linking.canOpenURL(trimmed);
    if (!canOpen) {
      return false;
    }
    await Linking.openURL(trimmed);
    return true;
  } catch {
    return false;
  }
}
