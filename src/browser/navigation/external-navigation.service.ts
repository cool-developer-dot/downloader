import * as Linking from 'expo-linking';

import { classifyBrowserNavigation } from '@/browser/navigation/browser-navigation-policy';

import { handleIntentNavigation, type IntentNavigationContext } from './intent-navigation.service';
import { isIntentScheme } from './intent-uri-resolver';

export { isIntentScheme } from './intent-uri-resolver';
export type { IntentNavigationContext } from './intent-navigation.service';

/**
 * Execute a classified non-document navigation.
 * Social/market/unknown never reach Linking.
 * intent:// never reaches Linking.openURL.
 */
export async function openIntentOrExternal(
  url: string,
  context?: IntentNavigationContext,
): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  const decision = classifyBrowserNavigation(trimmed);

  if (isIntentScheme(trimmed)) {
    if (!context) {
      return false;
    }
    const result = await handleIntentNavigation(trimmed, context);
    return result.handled;
  }

  if (decision.kind === 'SAFE_SYSTEM_ACTION' && decision.invokeLinking) {
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

  return false;
}
