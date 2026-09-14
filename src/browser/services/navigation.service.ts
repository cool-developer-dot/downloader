import * as Linking from 'expo-linking';

import { BROWSER_HOMEPAGE } from '@/browser/constants';
import type { NavigationIntent } from '@/browser/types';
import {
  classifyNavigationInput,
  hasAllowedScheme,
  isBlockedScheme,
  isBrowserHomeUrl,
  isExternalScheme,
  isSocialNativeAppScheme,
  resolveNavigationInput,
} from '@/browser/utils';

/**
 * Pure navigation policy helpers.
 * No UI, no store mutations, no WebView refs.
 */
export const navigationService = {
  classify(input: string): NavigationIntent {
    return classifyNavigationInput(input);
  },

  resolveInput(input: string): string | null {
    return resolveNavigationInput(input);
  },

  /**
   * Resolves omnibox submission into a URL or a structured failure.
   */
  resolveSubmission(
    input: string,
  ):
    | { ok: true; url: string; intent: NavigationIntent }
    | { ok: false; message: string; intent: NavigationIntent } {
    const intent = classifyNavigationInput(input);

    if (intent.kind === 'empty') {
      return {
        ok: false,
        message: 'Enter a website address or search the web.',
        intent,
      };
    }

    if (intent.kind === 'invalid' || intent.kind === 'blocked') {
      return { ok: false, message: intent.message, intent };
    }

    if (intent.kind === 'home') {
      return { ok: true, url: BROWSER_HOMEPAGE, intent };
    }

    if (intent.kind === 'navigate' || intent.kind === 'search') {
      return { ok: true, url: intent.url, intent };
    }

    return {
      ok: false,
      message: 'That doesn’t look like a valid address.',
      intent,
    };
  },

  shouldHandleInBrowser(url: string): boolean {
    if (isBrowserHomeUrl(url)) {
      return false;
    }

    if (isBlockedScheme(url) || isExternalScheme(url)) {
      return false;
    }

    return hasAllowedScheme(url);
  },

  async openExternal(url: string): Promise<boolean> {
    const trimmed = url.trim();
    // Never hand intent:// to Linking — use Intent resolver path instead.
    if (trimmed.toLowerCase().startsWith('intent:')) {
      return false;
    }
    if (isSocialNativeAppScheme(trimmed)) {
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
  },
} as const;
