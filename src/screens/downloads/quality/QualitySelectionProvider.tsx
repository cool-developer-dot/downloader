import { memo, useCallback, useMemo, createContext, useContext, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { pendingNavigationService } from '@/browser/services';
import { browserMediaActionService } from '@/browser/media-actions';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';
import { navigation, routePaths } from '@/navigation';
import {
  usePendingMediaResolution,
} from '@/media-detection/hooks/usePendingMediaResolution';
import type { PageResolutionCandidateResult } from '@/media-detection/services/page-media-resolution.service';
import { pendingMediaResolutionService } from '@/media-detection/services/pending-media-resolution.service';
import { isSameDocumentUrl } from '@/media-detection/utils';

import { invokeBrowserLoadUrl } from './browser-load-bridge';
import { notifyQualitySelectionDownloadCreated } from './download-created-bus';
import { QualitySelectionSheet } from './QualitySelectionSheet';
import {
  useQualitySelection,
  type UseQualitySelectionResult,
} from './useQualitySelection';

const QualitySelectionContext = createContext<UseQualitySelectionResult | null>(null);

export {
  registerQualitySelectionDownloadListener,
  registerQualitySelectionClosedListener,
  notifyQualitySelectionDownloadCreated,
  notifyQualitySelectionClosed,
} from './download-created-bus';

export function useQualitySelectionContext(): UseQualitySelectionResult {
  const ctx = useContext(QualitySelectionContext);
  if (!ctx) {
    throw new Error('useQualitySelectionContext must be used within QualitySelectionProvider');
  }
  return ctx;
}

export type QualitySelectionProviderProps = {
  children: ReactNode;
};

/**
 * Single shared Add Download surface across Home, Downloads, and Browser tabs.
 * Owns page-resolution watching so the analyze sheet can stay open during detection.
 */
export const QualitySelectionProvider = memo(function QualitySelectionProvider({
  children,
}: QualitySelectionProviderProps) {
  const navigateBrowserForResolution = useCallback(
    (input: { originalUrl: string; canonicalUrl: string }) => {
      const { canonicalUrl } = input;
      pendingNavigationService.set(canonicalUrl, {
        targetTabId: useBrowserStore.getState().activeTabId,
      });
      navigation.navigate(routePaths.browser);

      const current = useBrowserStore.getState().currentUrl;
      if (isBrowserHomeUrl(current) || !isSameDocumentUrl(current, canonicalUrl)) {
        invokeBrowserLoadUrl(canonicalUrl);
      }
    },
    [],
  );

  const qualitySelection = useQualitySelection({
    onDownloadCreated: notifyQualitySelectionDownloadCreated,
    onPageResolutionHandoff: navigateBrowserForResolution,
  });

  const openWithAnalysis = qualitySelection.openWithAnalysis;
  const isBrowserHandoffActive = qualitySelection.isBrowserHandoffActive;

  const onResolved = useCallback(
    (result: PageResolutionCandidateResult & { ok: true }) => {
      const pageUrl =
        pendingMediaResolutionService.get()?.canonicalUrl ??
        result.media.pageUrl ??
        result.analysis.sourceUrl;

      if (isBrowserHandoffActive()) {
        browserMediaActionService.handoffVerified({
          pageUrl,
          media: result.media,
          analysis: result.analysis,
          requestContext: result.requestContext,
          mediaUrl: result.mediaUrl,
          autoShow: true,
        });
        return;
      }

      openWithAnalysis(result.analysis, {
        sourceUrl: result.mediaUrl,
        requestContext: result.requestContext,
      });
    },
    [isBrowserHandoffActive, openWithAnalysis],
  );

  const onWaitingPlayback = useCallback(() => {
    const session = pendingMediaResolutionService.get();
    if (!session) {
      return;
    }
    AccessibilityInfo.announceForAccessibility(
      'Play the video once so VidoraX can detect the media',
    );
  }, []);

  const onTimeout = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(
      'No video detected yet. Open the video and try again.',
    );
  }, []);

  const handlers = useMemo(
    () => ({
      onResolved,
      onWaitingPlayback,
      onTimeout,
    }),
    [onResolved, onWaitingPlayback, onTimeout],
  );

  usePendingMediaResolution(handlers);

  return (
    <QualitySelectionContext.Provider value={qualitySelection}>
      {children}
      <QualitySelectionSheet controller={qualitySelection} />
    </QualitySelectionContext.Provider>
  );
});

export { registerBrowserLoadUrl } from './browser-load-bridge';
