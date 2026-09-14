import { navigationService } from '@/browser/services/navigation.service';
import { isBrowserHomeUrl } from '@/browser/utils';
import { isIntentScheme } from '@/browser/navigation/intent-uri-resolver';
import { classifyBrowserNavigation } from '@/browser/navigation/browser-navigation-policy';

export type PopupNavigationDecision =
  | { action: 'load_in_browser'; url: string }
  | { action: 'open_external'; url: string }
  | { action: 'ignore'; reason: string };

/**
 * Validates popup / target=_blank URLs — same classifier as main-frame loads.
 */
export function resolvePopupNavigation(targetUrl: string | null | undefined): PopupNavigationDecision {
  const trimmed = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  if (!trimmed || trimmed === 'about:blank') {
    return { action: 'ignore', reason: 'empty_target' };
  }

  if (isBrowserHomeUrl(trimmed)) {
    return { action: 'ignore', reason: 'home_url' };
  }

  const decision = classifyBrowserNavigation(trimmed);

  if (decision.kind === 'INTERNAL_WEB' && navigationService.shouldHandleInBrowser(trimmed)) {
    return { action: 'load_in_browser', url: trimmed };
  }

  if (decision.kind === 'INTENT_WEB_FALLBACK' && decision.internalUrl) {
    return { action: 'load_in_browser', url: decision.internalUrl };
  }

  if (isIntentScheme(trimmed) && (decision.kind === 'INTENT_WEB_FALLBACK' || decision.kind === 'INTENT_BLOCK' || decision.kind === 'BLOCK_NATIVE_APP')) {
    // Intent execution stays on the popup handler's owning-tab context.
    if (decision.kind === 'INTENT_WEB_FALLBACK' && decision.internalUrl) {
      return { action: 'load_in_browser', url: decision.internalUrl };
    }
    return { action: 'open_external', url: trimmed };
  }

  if (decision.invokeLinking && decision.kind === 'SAFE_SYSTEM_ACTION') {
    return { action: 'open_external', url: trimmed };
  }

  return { action: 'ignore', reason: decision.reason };
}
