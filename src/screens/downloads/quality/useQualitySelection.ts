import { AccessibilityInfo } from 'react-native';
import type { MediaAnalysisResult } from '@/api/types';
import {
  analyzeFailureCopy,
  analyzeProgressCopy,
  isAnalyzeBusy,
  mapPendingStatusToAnalyzePhase,
  type AnalyzeFlowKind,
  type AnalyzePhase,
} from '@/downloads/analyze/analyze-state-machine';
import { analyzeMediaUrl, LocalAnalyzeNetworkError } from '@/downloads/analyze';
import {
  classifyPasteInput,
  startPageMediaResolution,
  describePendingResolutionMessage,
} from '@/media-detection/services/page-media-resolution.service';
import { pendingMediaResolutionService } from '@/media-detection/services/pending-media-resolution.service';
import { logPasteMediaDiagnostic } from '@/media-detection/services/paste-media-diagnostics.service';
import {
  logPageFlow,
  safePageHostname,
} from '@/media-detection/services/page-flow-diagnostics.service';
import { resolvePastePlatformKind } from '@/media-detection/services/platform-page-url';
import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { notifyQualitySelectionClosed } from './download-created-bus';
import { runPreDownloadGate } from '@/media-detection/services/pre-download-gate.service';
import { refreshMediaFromPage } from '@/media-detection/services/media-refresh.service';
import {
  buildMediaRequestContext,
  buildMediaRequestContextSync,
} from '@/media-detection/services/request-context.service';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { enqueueVerifiedBrowserVariant } from '@/browser/media-actions/browser-media-download.service';
import { selectVerifiedStandaloneQualities } from '@/browser/media-actions/verified-quality-options';
import { buildResourceIdentityKey, sameResourceFamily } from '@/media-detection/social-source/resource-identity';
import {
  resolveSocialPlatform,
  socialPageContextStore,
} from '@/media-detection/social';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import { useMediaDetectionStore } from '@/media-detection/stores';
import type { PlatformPageKind } from '@/media-detection/platform/types';
import {
  findQualityOptionById,
  normalizeAnalysisToSelection,
  selectDefaultQualityOption,
  toCreateDownloadInput,
  unsupportedReasonCopy,
  type AnalyzedMediaSelection,
  type QualityOption,
} from '@/downloads/quality';
import { isSafeMediaUrl } from '@/media-detection/utils';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { useDownloadsStore } from '@/store/downloads';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { translate } from '@/localization';

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { name?: string; code?: string; message?: string };
  if (maybe.name === 'CanceledError' || maybe.name === 'AbortError') {
    return true;
  }
  if (maybe.code === 'ERR_CANCELED') {
    return true;
  }
  if (error instanceof LocalAnalyzeNetworkError && error.kind === 'aborted') {
    return true;
  }
  return typeof maybe.message === 'string' && /cancel|abort/i.test(maybe.message);
}

/**
 * Phase 5C — quality-sheet confirm must not apply a stale SPA/page generation.
 */
function isQualityFreezeStillCurrent(tabId: string): boolean {
  if (!browserMediaActionService.isQualitySelectionOfferCurrent(tabId)) {
    return false;
  }
  const freeze = browserMediaActionService.getQualitySelectionFreeze(tabId);
  if (!freeze) {
    return false;
  }
  const navigationEpoch = useMediaDetectionStore.getState().navigationEpoch;
  if (freeze.navigationEpoch !== navigationEpoch) {
    return false;
  }
  if (freeze.socialContextGeneration != null) {
    const social = socialPageContextStore.get(tabId);
    if (!social || social.contextGeneration !== freeze.socialContextGeneration) {
      return false;
    }
    if (social.navigationEpoch !== freeze.navigationEpoch) {
      return false;
    }
    return true;
  }
  if (freeze.pageGeneration != null) {
    const general = generalPageMediaContextStore.get(tabId);
    if (!general || general.pageGeneration !== freeze.pageGeneration) {
      return false;
    }
    if (general.navigationEpoch !== freeze.navigationEpoch) {
      return false;
    }
  }
  return true;
}

function mapAnalyzeError(error: unknown): string {
  if (error instanceof LocalAnalyzeNetworkError) {
    if (error.kind === 'timeout' || error.kind === 'unreachable') {
      return translate('errors.network');
    }
    if (error.kind === 'unsafe') {
      return translate('downloads.invalidUrl');
    }
    return error.message || translate('downloads.qualityErrorTitle');
  }

  if (error instanceof Error && error.message.trim()) {
    return analyzeFailureCopy(error.message);
  }

  return translate('downloads.qualityErrorTitle');
}

function validatePasteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return translate('downloads.missingUrl');
  }
  if (!isSafeMediaUrl(trimmed)) {
    return translate('downloads.invalidUrl');
  }
  return null;
}

export type UseQualitySelectionResult = {
  visible: boolean;
  url: string;
  urlError: string | null;
  phase: AnalyzePhase;
  flowKind: AnalyzeFlowKind;
  platform: PlatformPageKind | null;
  progressMessage: string | null;
  selection: AnalyzedMediaSelection | null;
  selectedId: string | null;
  selectedOption: QualityOption | null;
  errorMessage: string | null;
  emptyMessage: string | null;
  creating: boolean;
  createError: string | null;
  analyzing: boolean;
  open: () => void;
  openWithUrl: (
    url: string,
    analyzeOptions?: {
      referer?: string | null;
      requestContext?: MediaRequestContext | null;
    },
  ) => Promise<void>;
  openWithAnalysis: (
    analysis: MediaAnalysisResult,
    options?: {
      sourceUrl?: string;
      requestContext?: MediaRequestContext | null;
    },
  ) => void;
  close: () => void;
  setUrl: (value: string) => void;
  pasteUrl: (value: string) => void;
  analyze: () => Promise<void>;
  retry: () => Promise<void>;
  resetToInput: () => void;
  selectOption: (id: string) => void;
  confirmDownload: () => Promise<boolean>;
  openPendingInBrowser: () => void;
  dismissForPlaybackHandoff: () => void;
  isBrowserHandoffActive: () => boolean;
};

/**
 * Paste → analyze → select → create download.
 * Owns local selection only; job creation goes through the existing downloads store.
 */
export function useQualitySelection(
  options?: {
    onDownloadCreated?: () => void;
    onPageResolutionHandoff?: (input: {
      originalUrl: string;
      canonicalUrl: string;
    }) => void;
  },
): UseQualitySelectionResult {
  const create = useDownloadsStore((state) => state.create);
  const onDownloadCreated = options?.onDownloadCreated;
  const onPageResolutionHandoff = options?.onPageResolutionHandoff;

  const [visible, setVisible] = useState(false);
  const [url, setUrlState] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phase, setPhase] = useState<AnalyzePhase>('idle');
  const [flowKind, setFlowKind] = useState<AnalyzeFlowKind>(null);
  const [platform, setPlatform] = useState<PlatformPageKind | null>(null);
  const [selection, setSelection] = useState<AnalyzedMediaSelection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const analyzingRef = useRef(false);
  const creatingRef = useRef(false);
  const requestContextRef = useRef<MediaRequestContext | null>(null);
  const browserHandoffActiveRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const syncPhaseFromPendingSession = useCallback(() => {
    const session = pendingMediaResolutionService.get();
    if (!session) {
      return;
    }
    setPlatform(session.platform);
    setFlowKind('page');
    setPhase(mapPendingStatusToAnalyzePhase(session.status));
  }, []);

  useEffect(() => {
    return pendingMediaResolutionService.subscribe(() => {
      const session = pendingMediaResolutionService.get();
      if (!session || !visible) {
        return;
      }
      if (flowKind !== 'page' && session.status !== 'failed' && session.status !== 'timeout') {
        return;
      }
      syncPhaseFromPendingSession();
      if (session.status === 'failed' || session.status === 'timeout') {
        setErrorMessage(analyzeFailureCopy(session.failureReason));
        setPhase('failed');
      }
    });
  }, [flowKind, syncPhaseFromPendingSession, visible]);

  const resetTransient = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    analyzingRef.current = false;
    creatingRef.current = false;
    requestContextRef.current = null;
    browserHandoffActiveRef.current = false;
    setPhase('idle');
    setFlowKind(null);
    setPlatform(null);
    setSelection(null);
    setSelectedId(null);
    setErrorMessage(null);
    setCreateError(null);
    setCreating(false);
    setUrlError(null);
  }, []);

  const dismissForPlaybackHandoff = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    analyzingRef.current = false;
    browserHandoffActiveRef.current = true;
    setVisible(false);
    logPageFlow('sheet_close', {
      sessionId: pendingMediaResolutionService.get()?.id ?? null,
      reason: 'playback_handoff',
    });
  }, []);

  const open = useCallback(() => {
    // Phase 2: paste/open uses normal Browser navigation — no Analyze Link sheet.
    navigation.navigate(routePaths.browser);
  }, []);

  const close = useCallback((options?: { consumed?: boolean }) => {
    const session = pendingMediaResolutionService.get();
    const handoffActive =
      session != null &&
      session.status !== 'verified' &&
      session.status !== 'failed' &&
      session.status !== 'timeout';

    abortRef.current?.abort();
    abortRef.current = null;
    setVisible(false);

    if (handoffActive) {
      analyzingRef.current = false;
      return;
    }

    resetTransient();
    setUrlState('');

    // Browser CTA: sheet dismiss without Phase 1 admit → restore AVAILABLE.
    // Success path notifies created first, then close({ consumed: true }).
    if (!options?.consumed) {
      notifyQualitySelectionClosed();
    }
  }, [resetTransient]);

  const setUrl = useCallback((value: string) => {
    setUrlState(value);
    setUrlError(null);
  }, []);

  const pasteUrl = useCallback((value: string) => {
    setUrlState(value.trim());
    setUrlError(null);
  }, []);

  const applyAnalysis = useCallback((analysis: MediaAnalysisResult) => {
    const next = normalizeAnalysisToSelection(analysis);
    const standalone = selectVerifiedStandaloneQualities(next.options);
    const filtered = { ...next, options: standalone };
    const defaultOption = selectDefaultQualityOption(filtered.options);
    setSelection(filtered);
    setSelectedId(defaultOption?.id ?? null);

    const hasDownloadable = filtered.options.length > 0;
    if (!hasDownloadable) {
      setPhase('empty');
      return;
    }

    setPhase('ready');
  }, []);

  const runAnalyze = useCallback(
    async (
      rawUrl: string,
      analyzeOptions?: {
        referer?: string | null;
        requestContext?: MediaRequestContext | null;
      },
    ) => {
      if (analyzingRef.current || creatingRef.current) {
        return;
      }

      const validationError = validatePasteUrl(rawUrl);
      if (validationError) {
        setUrlError(validationError);
        return;
      }

      const trimmed = rawUrl.trim();
      const detectedPlatform = resolvePastePlatformKind(trimmed);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      analyzingRef.current = true;

      setErrorMessage(null);
      setCreateError(null);
      setSelection(null);
      setSelectedId(null);
      setUrlError(null);
      setPlatform(detectedPlatform);

      if (classifyPasteInput(trimmed) === 'page') {
        setFlowKind('page');
        setPhase('validating_url');
        logPageFlow('classified', { kind: 'page', hostname: safePageHostname(trimmed) });

        try {
          setPhase('identifying_platform');
          setPhase('resolving_page');

          logPageFlow('resolve_start', { hostname: safePageHostname(trimmed) });
          const started = await startPageMediaResolution(trimmed, controller.signal);
          if (!mountedRef.current || requestId !== requestIdRef.current) {
            return;
          }

          const session = pendingMediaResolutionService.get();
          logPageFlow('session_created', {
            sessionId: session?.id ?? null,
            platform: started.platform,
            hostname: safePageHostname(started.canonicalUrl),
          });

          pendingNavigationService.set(started.canonicalUrl, {
            targetTabId: useBrowserStore.getState().activeTabId,
          });
          pendingMediaResolutionService.update({ status: 'waiting_media' });
          setPhase('detecting_media');

          onPageResolutionHandoff?.({
            originalUrl: started.originalUrl,
            canonicalUrl: started.canonicalUrl,
          });
          if (started.platform === 'tiktok' || started.platform === 'instagram') {
            setPhase('waiting_for_playback');
          }
          logPageFlow('navigate_browser', {
            sessionId: session?.id ?? null,
            platform: started.platform,
          });
        } catch (error) {
          if (!mountedRef.current || requestId !== requestIdRef.current) {
            return;
          }
          if (isAbortError(error) || controller.signal.aborted) {
            return;
          }
          pendingMediaResolutionService.fail('resolution_failed');
          logPageFlow('failure', {
            stage: 'resolver',
            reason: error instanceof Error ? error.message : 'resolution_failed',
          });
          logPasteMediaDiagnostic('failure', {
            stage: 'resolver',
            reason: error instanceof Error ? error.message : 'resolution_failed',
          });
          setPhase('failed');
          setErrorMessage(mapAnalyzeError(error));
        } finally {
          if (requestId === requestIdRef.current) {
            analyzingRef.current = false;
          }
        }
        return;
      }

      setFlowKind('direct');
      setPhase('validating_url');

      try {
        setPhase('identifying_platform');
        setPhase('fetching_metadata');

        const analysis = await analyzeMediaUrl(trimmed, {
          signal: controller.signal,
          referer: analyzeOptions?.referer,
          userAgent: analyzeOptions?.requestContext?.userAgent ?? null,
          requestContext: analyzeOptions?.requestContext ?? null,
        });

        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        applyAnalysis(analysis);
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }

        setPhase('failed');
        setErrorMessage(mapAnalyzeError(error));
      } finally {
        if (requestId === requestIdRef.current) {
          analyzingRef.current = false;
        }
      }
    },
    [applyAnalysis, onPageResolutionHandoff],
  );

  const openWithAnalysis = useCallback(
    (
      analysis: MediaAnalysisResult,
      openOptions?: {
        sourceUrl?: string;
        requestContext?: MediaRequestContext | null;
      },
    ) => {
      browserHandoffActiveRef.current = false;
      requestContextRef.current = openOptions?.requestContext ?? null;
      setUrlState(openOptions?.sourceUrl ?? analysis.sourceUrl);
      setVisible(true);
      setFlowKind('page');
      setPhase('fetching_metadata');
      applyAnalysis(analysis);
    },
    [applyAnalysis],
  );

  const openPendingInBrowser = useCallback(() => {
    const session = pendingMediaResolutionService.get();
    if (session?.canonicalUrl) {
      pendingNavigationService.set(session.canonicalUrl, {
        targetTabId: useBrowserStore.getState().activeTabId,
      });
    }
    onPageResolutionHandoff?.({
      originalUrl: session?.originalUrl ?? url.trim(),
      canonicalUrl: session?.canonicalUrl ?? url.trim(),
    });
    dismissForPlaybackHandoff();
  }, [dismissForPlaybackHandoff, onPageResolutionHandoff, url]);

  const openWithUrl = useCallback(
    async (
      rawUrl: string,
      analyzeOptions?: {
        referer?: string | null;
        requestContext?: MediaRequestContext | null;
      },
    ) => {
      if (analyzingRef.current || creatingRef.current) {
        return;
      }
      const trimmed = rawUrl.trim();
      resetTransient();
      requestContextRef.current = analyzeOptions?.requestContext ?? null;
      setUrlState(trimmed);
      setVisible(true);
      await runAnalyze(trimmed, analyzeOptions);
    },
    [resetTransient, runAnalyze],
  );

  const analyze = useCallback(async () => {
    await runAnalyze(url);
  }, [runAnalyze, url]);

  const retry = useCallback(async () => {
    pendingMediaResolutionService.clear();
    setPhase('idle');
    setErrorMessage(null);
    await runAnalyze(url);
  }, [runAnalyze, url]);

  const resetToInput = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    analyzingRef.current = false;
    creatingRef.current = false;
    pendingMediaResolutionService.clear();
    setPhase('idle');
    setFlowKind(null);
    setPlatform(null);
    setSelection(null);
    setSelectedId(null);
    setErrorMessage(null);
    setCreateError(null);
    setCreating(false);
  }, []);

  const selectOption = useCallback(
    (id: string) => {
      if (!selection || creatingRef.current) {
        return;
      }
      const option = findQualityOptionById(selection.options, id);
      if (!option) {
        return;
      }
      setSelectedId(option.id);
      setCreateError(null);
    },
    [selection],
  );

  const selectedOption = useMemo(
    () => (selection != null ? findQualityOptionById(selection.options, selectedId) : null),
    [selection, selectedId],
  );

  const progressMessage = useMemo(
    () =>
      analyzeProgressCopy(phase, {
        flowKind,
        platform,
      }),
    [flowKind, phase, platform],
  );

  const emptyMessage = useMemo(() => {
    if (phase === 'waiting_for_playback') {
      return (
        describePendingResolutionMessage(pendingMediaResolutionService.get()) ??
        progressMessage
      );
    }
    if (phase !== 'empty') {
      return null;
    }
    const unsupportedFromOption = selection?.options.find(
      (option) => !option.downloadable,
    )?.unavailableReason;
    return unsupportedReasonCopy(
      unsupportedFromOption ?? selection?.unsupportedReason ?? null,
    );
  }, [phase, progressMessage, selection]);

  const analyzing = isAnalyzeBusy(phase) || phase === 'waiting_for_playback';

  const confirmDownload = useCallback(async () => {
    if (creatingRef.current || analyzingRef.current) {
      return false;
    }

    if (!selection || !selectedOption) {
      setCreateError(translate('downloads.selectionHint'));
      return false;
    }

    if (!selectedOption.downloadable) {
      setCreateError(translate('downloads.selectionHint'));
      return false;
    }

    const tabIdForScope =
      browserMediaActionService.getActiveTabId() ?? '__default__';
    // Stale SPA / recycled-player quality confirm must no-op.
    if (
      browserMediaActionService.isSelectionLocked() &&
      !isQualityFreezeStillCurrent(tabIdForScope)
    ) {
      browserMediaActionService.endQualitySelection(tabIdForScope);
      setCreateError(translate('downloads.selectionHint'));
      setPhase('ready');
      return false;
    }

    const payload = toCreateDownloadInput(selection, selectedOption);
    if (!payload) {
      setCreateError(translate('downloads.selectionHint'));
      return false;
    }

    // A verified browser offer hands the exact chosen variant to the v2 engine: no re-resolve, no v1 transfer.
    if (browserMediaActionService.isSelectionLocked()) {
      creatingRef.current = true;
      setCreating(true);
      setCreateError(null);
      setPhase('creating_download');
      try {
        const ctaState = browserMediaActionService.getState();
        const handoff = await enqueueVerifiedBrowserVariant({
          selection,
          option: selectedOption,
          requestContext: requestContextRef.current,
          pageUrl: ctaState.pageUrl,
          contentIdentity: ctaState.contentIdentity,
          isOfferCurrent: () => isQualityFreezeStillCurrent(tabIdForScope),
        });
        if (!mountedRef.current) {
          return false;
        }
        if (!handoff.ok) {
          setCreateError(handoff.message);
          setPhase('ready');
          return false;
        }
        setPhase('downloading');
        AccessibilityInfo.announceForAccessibility(
          handoff.deduped ? 'Already in your downloads' : 'Download started',
        );
        onDownloadCreated?.();
        close({ consumed: true });
        return true;
      } catch {
        if (mountedRef.current) {
          setCreateError('Couldn’t start this download.');
          setPhase('ready');
        }
        return false;
      } finally {
        creatingRef.current = false;
        if (mountedRef.current) {
          setCreating(false);
        }
      }
    }

    const isHlsOption =
      selectedOption.streamType === 'HLS' ||
      selectedOption.isHls === true ||
      selectedOption.container === 'hls';
    const gateTransport = isHlsOption
      ? ('HLS' as const)
      : selectedOption.streamType === 'AUDIO'
        ? ('AUDIO' as const)
        : selectedOption.streamType === 'PROGRESSIVE'
          ? ('PROGRESSIVE' as const)
          : null;

    // HLS paste / Add Download must use HLS manifest gate — never progressive size checks.
    // Build a minimal request context when browser session context is absent.
    let ctx = requestContextRef.current;
    if (!ctx && isHlsOption) {
      ctx = buildMediaRequestContextSync({ mediaUrl: payload.sourceUrl });
    }

    // Lock before the first async gate so rapid confirmations cannot enqueue twice.
    creatingRef.current = true;
    setCreating(true);
    try {
    if (ctx) {
      setPhase('verifying_media');
      const gate = await runPreDownloadGate({
        sourceUrl: payload.sourceUrl,
        requestContext: ctx,
        verifiedAtMs: ctx.capturedAt,
        transport: gateTransport,
      });
      if (!gate.ok) {
        if (gate.refreshable && pendingMediaResolutionService.get()?.canonicalUrl) {
          const session = pendingMediaResolutionService.get();
          if (session?.canonicalUrl) {
            const refresh = await refreshMediaFromPage({
              pageUrl: session.canonicalUrl,
              previousMediaUrl: payload.sourceUrl,
              requiresCookies: ctx.cookiesRequired,
            });
            if (refresh.ok && refresh.mediaUrl && sameResourceFamily(payload.sourceUrl, refresh.mediaUrl)) {
              const refreshedCtx = await buildMediaRequestContext({
                mediaUrl: refresh.mediaUrl,
                pageUrl: refresh.pageUrl ?? session.canonicalUrl,
                originalPageUrl: session.originalUrl,
                requiresCookies: ctx.cookiesRequired,
              });
              const retryGate = await runPreDownloadGate({
                sourceUrl: refresh.mediaUrl,
                requestContext: refreshedCtx,
                transport: gateTransport,
              });
              if (retryGate.ok) {
                requestContextRef.current = retryGate.requestContext;
                payload.sourceUrl = retryGate.finalUrl;
                if (
                  retryGate.transport !== 'HLS' &&
                  retryGate.contentLength != null &&
                  retryGate.contentLength > 0
                ) {
                  payload.fileSize = retryGate.contentLength;
                }
              } else {
                setCreateError(retryGate.userMessage);
                setPhase('ready');
                return false;
              }
            } else {
              setCreateError(gate.userMessage);
              setPhase('ready');
              return false;
            }
          } else {
            setCreateError(gate.userMessage);
            setPhase('ready');
            return false;
          }
        } else {
          setCreateError(gate.userMessage);
          setPhase('ready');
          return false;
        }
      } else {
        requestContextRef.current = gate.requestContext;
        payload.sourceUrl = gate.finalUrl;
        if (
          gate.transport !== 'HLS' &&
          gate.contentLength != null &&
          gate.contentLength > 0
        ) {
          payload.fileSize = gate.contentLength;
        }
      }
    }

    setCreateError(null);
    setPhase('creating_download');

      const ctaState = browserMediaActionService.getState();
      const tabId = browserMediaActionService.getActiveTabId() ?? '__default__';
      if (
        browserMediaActionService.isSelectionLocked() &&
        !isQualityFreezeStillCurrent(tabId)
      ) {
        browserMediaActionService.endQualitySelection(tabId);
        setCreateError(translate('downloads.selectionHint'));
        setPhase('ready');
        return false;
      }

      // Phase 5C — social refresh identity only on social pages.
      const pageUrl = ctaState.pageUrl;
      const socialPlatform = pageUrl ? resolveSocialPlatform(pageUrl) : null;
      const freeze = browserMediaActionService.getQualitySelectionFreeze(tabId);
      const socialSourceIdentity =
        socialPlatform && ctaState.contentIdentity && ctaState.variantIdentity
          ? {
              contentIdentity: ctaState.contentIdentity,
              variantIdentity: buildResourceIdentityKey({
                contentIdentity: ctaState.contentIdentity,
                executableUrl: selectedOption.sourceUrl,
                transport:
                  selectedOption.streamType === 'AUDIO'
                    ? 'audio_only'
                    : isHlsOption
                      ? 'hls'
                      : selectedOption.streamType === 'DASH'
                        ? 'dash'
                        : 'progressive',
                width: selectedOption.width,
                height: selectedOption.height,
                bitrate: selectedOption.bitrate,
                container: selectedOption.container,
              }),
              tabId,
              pageUrl: ctaState.pageUrl,
              navigationEpoch:
                freeze?.navigationEpoch ??
                useMediaDetectionStore.getState().navigationEpoch,
              socialContextGeneration:
                freeze?.socialContextGeneration ??
                socialPageContextStore.get(tabId)?.contextGeneration ??
                null,
            }
          : null;

      const created = await create({
        ...payload,
        requestContext: requestContextRef.current,
        socialSourceIdentity,
      });
      if (!mountedRef.current) {
        return false;
      }

      if (!created) {
        const storeError = useDownloadsStore.getState().error;
        setCreateError(storeError?.trim() || 'Couldn’t start this download.');
        setPhase('ready');
        return false;
      }

      setPhase('downloading');
      AccessibilityInfo.announceForAccessibility('Download started');
      onDownloadCreated?.();
      close({ consumed: true });
      return true;
    } catch {
      if (mountedRef.current) {
        setCreateError('Couldn’t start this download.');
        setPhase('ready');
      }
      return false;
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  }, [close, create, onDownloadCreated, selectedOption, selection]);

  return {
    visible,
    url,
    urlError,
    phase,
    flowKind,
    platform,
    progressMessage,
    selection,
    selectedId,
    selectedOption,
    errorMessage,
    emptyMessage,
    creating,
    createError,
    analyzing,
    open,
    openWithUrl,
    openWithAnalysis,
    close,
    setUrl,
    pasteUrl,
    analyze,
    retry,
    resetToInput,
    selectOption,
    confirmDownload,
    openPendingInBrowser,
    dismissForPlaybackHandoff,
    isBrowserHandoffActive: () => browserHandoffActiveRef.current,
  };
}
