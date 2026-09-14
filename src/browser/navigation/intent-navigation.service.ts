/**
 * Tab-owned Android intent:// execution.
 * Captures targetTabId + generation + epoch at request time — never retargets later.
 */
import { logBrowserNav, sanitizeBrowserUrl } from '@/browser/diagnostics';
import { navigationService } from '@/browser/services/navigation.service';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';

import { isPlayStoreOrMarketWebUrl } from './browser-navigation-policy';
import { rememberIntentFingerprint } from './intent-loop-guard';
import {
  isAppLinkBounceHost,
  isIntentScheme,
  resolveAndroidIntentUri,
  type IntentResolution,
} from './intent-uri-resolver';

export type IntentNavigationContext = {
  targetTabId: string;
  navigationEpoch: number;
  controllerGeneration: number;
  /** Committed page URL of the owning tab when the intent was emitted. */
  currentPageUrl: string | null;
};

export {
  clearIntentLoopGuardForTab,
  __resetIntentLoopGuardsForTests,
} from './intent-loop-guard';

function resolveLiveOwnedController(context: IntentNavigationContext) {
  const tabExists = useBrowserStore.getState().tabs.some((t) => t.id === context.targetTabId);
  if (!tabExists) {
    return null;
  }
  const controller = tabControllerRegistry.get(context.targetTabId);
  if (!controller || controller.tabId !== context.targetTabId) {
    return null;
  }
  if (controller.webViewInstanceGenerationRef.current !== context.controllerGeneration) {
    return null;
  }
  if (controller.webViewInstanceGenerationRef.current <= 0) {
    return null;
  }
  return controller;
}

function hostsRelated(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const left = a.replace(/^www\./i, '').toLowerCase();
  const right = b.replace(/^www\./i, '').toLowerCase();
  if (left === right) {
    return true;
  }
  if (left.endsWith(`.${right}`) || right.endsWith(`.${left}`)) {
    return true;
  }
  const leftRoot = left.split('.').slice(-2).join('.');
  const rightRoot = right.split('.').slice(-2).join('.');
  return leftRoot.length > 0 && leftRoot === rightRoot;
}

function shouldAvoidAppLinkWebLoad(
  resolution: IntentResolution,
  currentPageUrl: string | null,
): boolean {
  if (resolution.type !== 'WEB_FALLBACK') {
    return false;
  }
  if (resolution.source === 'browser_fallback_url') {
    return false;
  }
  try {
    const fallbackHost = new URL(resolution.url).hostname;
    if (!isAppLinkBounceHost(fallbackHost)) {
      return false;
    }
    if (!currentPageUrl || isBrowserHomeUrl(currentPageUrl)) {
      return true;
    }
    const currentHost = new URL(currentPageUrl).hostname;
    return hostsRelated(fallbackHost, currentHost);
  } catch {
    return true;
  }
}

/**
 * Resolve + execute one intent:// navigation for a captured owning tab.
 * Website-originated intents never launch native social apps.
 * Never calls Linking.openURL with raw intent://.
 */
export async function handleIntentNavigation(
  intentUrl: string,
  context: IntentNavigationContext,
): Promise<{ handled: boolean; resolution: IntentResolution | null }> {
  const trimmed = intentUrl.trim();
  if (!trimmed || !isIntentScheme(trimmed)) {
    return { handled: false, resolution: null };
  }

  const resolution = resolveAndroidIntentUri(trimmed);
  const navMeta = sanitizeBrowserUrl(trimmed);

  if (
    !rememberIntentFingerprint(
      context.targetTabId,
      context.navigationEpoch,
      resolution.fingerprint,
    )
  ) {
    logBrowserNav(context.navigationEpoch, 'block', {
      decision: false,
      decisionReason: 'intent_loop_guard',
      safeHost: navMeta.safeHost,
      tabId: context.targetTabId,
    });
    return { handled: true, resolution };
  }

  const controller = resolveLiveOwnedController(context);
  if (!controller) {
    logBrowserNav(context.navigationEpoch, 'block', {
      decision: false,
      decisionReason: 'intent_stale_controller',
      safeHost: navMeta.safeHost,
      tabId: context.targetTabId,
    });
    return { handled: true, resolution };
  }

  if (
    resolution.type === 'WEB_FALLBACK' &&
    isPlayStoreOrMarketWebUrl(resolution.url)
  ) {
    logBrowserNav(context.navigationEpoch, 'block', {
      decision: false,
      decisionReason: 'intent_play_store_fallback_contained',
      safeHost: navMeta.safeHost,
      tabId: context.targetTabId,
    });
    return { handled: true, resolution };
  }

  if (shouldAvoidAppLinkWebLoad(resolution, context.currentPageUrl)) {
    // Stay inside VidoraX — do not launch Instagram/TikTok/etc. for applink bounce.
    logBrowserNav(context.navigationEpoch, 'block', {
      decision: false,
      decisionReason: 'intent_applink_contained',
      safeHost: navMeta.safeHost,
      tabId: context.targetTabId,
    });
    return { handled: true, resolution };
  }

  if (resolution.type === 'WEB_FALLBACK') {
    if (!navigationService.shouldHandleInBrowser(resolution.url)) {
      logBrowserNav(context.navigationEpoch, 'block', {
        decision: false,
        decisionReason: 'intent_fallback_rejected',
        safeHost: navMeta.safeHost,
        tabId: context.targetTabId,
      });
      return { handled: true, resolution };
    }

    const live = resolveLiveOwnedController(context);
    if (!live) {
      return { handled: true, resolution };
    }

    logBrowserNav(context.navigationEpoch, 'chrome_load', {
      decisionReason: 'intent_web_fallback',
      safeHost: sanitizeBrowserUrl(resolution.url).safeHost,
      tabId: context.targetTabId,
    });
    live.loadUrl(resolution.url);
    return { handled: true, resolution };
  }

  if (resolution.type === 'EXTERNAL_APP') {
    logBrowserNav(context.navigationEpoch, 'block', {
      decision: false,
      decisionReason: 'intent_external_app_contained',
      safeHost: navMeta.safeHost,
      tabId: context.targetTabId,
    });
    return { handled: true, resolution };
  }

  logBrowserNav(context.navigationEpoch, 'block', {
    decision: false,
    decisionReason: `intent_${resolution.reason}`,
    safeHost: navMeta.safeHost,
    tabId: context.targetTabId,
  });
  return { handled: true, resolution };
}
