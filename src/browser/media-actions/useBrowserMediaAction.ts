import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { selectIsHome, selectBrowserError, useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { buildAnalysisFromVerification } from '@/downloads/analyze/analyze-from-verification';
import {
  normalizeAnalysisToSelection,
  selectDefaultQualityOption,
} from '@/downloads/quality';
import { verifyMediaCandidate } from '@/media-detection/services/candidate-verifier.service';
import {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from '@/media-detection/services/automatic-handoff-diagnostics';
import {
  completePageResolutionWithMedia,
  tryCompletePageResolutionFromStore,
} from '@/media-detection/services/page-media-resolution.service';
import { pendingMediaResolutionService } from '@/media-detection/services/pending-media-resolution.service';
import { buildRequestContextFromDetectedMedia } from '@/media-detection/services/request-context.service';
import { getMsePlaybackContext } from '@/media-detection/engine/mse-playback-context';
import { useMediaDiscovery } from '@/media-detection/hooks/useMediaDiscovery';
import { useMediaDetectionStore } from '@/media-detection/stores';
import { isSafeMediaUrl, isSameDocumentUrl } from '@/media-detection/utils';
import {
  resolveSocialPlatform,
  selectCurrentMediaForActiveSocialTab,
  socialPageContextStore,
} from '@/media-detection/social';
import {
  generalPageMediaContextStore,
  selectCurrentMediaForActiveGeneralTab,
} from '@/media-detection/general-media';
import { isSameGeneralContentNavigation } from '@/media-detection/general-media/general-content-navigation';
import {
  hashSafeId,
  logGeneralDownloadTrace,
  logGeneralVerifyTrace,
} from '@/media-detection/general-media/general-media-diagnostics';
import { buildVerifiedSocialMediaOffer } from '@/media-detection/social-source';
import { buildVerifiedGeneralMediaOffer } from '@/media-detection/general-source';
import {
  registerQualitySelectionClosedListener,
  registerQualitySelectionDownloadListener,
} from '@/screens/downloads/quality/download-created-bus';

import {
  shouldAcceptVerificationResult,
  shouldInvalidateCurrentMedia,
  shouldRetainAvailableCta,
  shouldStartVerification,
} from './cta-persistence';
import { browserMediaActionService } from './browser-media-action.service';
import type { BrowserMediaActionState } from './browser-media-action.types';
import { toBrowserMediaCtaState } from './browser-media-action.types';
import { enqueueBrowserMediaDownload } from './browser-media-download.service';
import {
  buildBrowserDownloadPresentation,
  resolveLivePresentationOwnership,
  type BrowserDownloadPresentation,
} from './browser-download-presentation';
import {
  fingerprintDiagHash,
  logBrowserCta,
} from './browser-cta-diagnostics';
import { buildBrowserMediaFingerprint } from './media-fingerprint';
import {
  classifyMediaResolutionOutcome,
  isDownloadResolutionTokenCurrent,
  type DownloadResolutionToken,
  type MediaResolutionOutcome,
} from './media-resolution-outcome';
import { logMediaResolveTrace } from './media-resolve-diagnostics';
import { mergeEligibleWindowCandidates } from '@/media-detection/observation/candidate-observation-window';
import {
  selectVerifiedStandaloneQualities,
} from './verified-quality-options';

export type UseBrowserMediaActionOptions = {
  onOpenQualitySheet?: (
    sourceUrl: string,
    options?: {
      referer?: string | null;
      requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
    },
  ) => void | Promise<void>;
  onDownloadStarted?: (downloadId: string) => void;
  /** When true (tab switcher / blocking overlay), final CTA is suppressed. */
  overlayBlocking?: boolean;
};

export type BrowserMediaActionViewModel = BrowserMediaActionState & {
  visible: boolean;
  expanded: boolean;
  platformLabel: string | null;
  metaLine: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  audioLabel: string | null;
  format: string | null;
  sizeLabel: string | null;
  qualityLabel: string | null;
  eyebrow: string;
  buttonLabel: string;
  presentation: BrowserDownloadPresentation;
  hasMultipleQualities: boolean;
  downloadable: boolean;
  ctaState: ReturnType<typeof toBrowserMediaCtaState>;
  dismiss: () => void;
  download: () => Promise<{
    ok: boolean;
    downloadId?: string;
    outcome?: MediaResolutionOutcome;
  }>;
  viewDownloads: () => void;
  openLibrary: () => void;
};

/**
 * Unified Browser media-action layer: correlate → verify → download CTA.
 * CTA is an entry point only — hide after successful Phase 1 enqueue.
 */
export function useBrowserMediaAction(
  options: UseBrowserMediaActionOptions = {},
): BrowserMediaActionViewModel {
  const isHome = useBrowserStore(selectIsHome);
  const browserError = useBrowserStore(selectBrowserError);
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const lastNavigation = useMediaDetectionStore((s) => s.lastNavigation);
  const discovery = useMediaDiscovery();
  const overlayBlocking = Boolean(options.overlayBlocking);

  const [actionState, setActionState] = useState<BrowserMediaActionState>(
    () => browserMediaActionService.getState(),
  );

  const verifyingRef = useRef(false);
  const prevNavRef = useRef<string | null>(null);
  const qualityHandoffRef = useRef<{
    tabId: string;
    fingerprint: string;
  } | null>(null);

  useEffect(() => {
    return browserMediaActionService.subscribe(() => {
      setActionState(browserMediaActionService.getState());
    });
  }, []);

  const [ownerRevision, setOwnerRevision] = useState(0);
  useEffect(() => {
    const bump = () => setOwnerRevision((n) => n + 1);
    const unsubSocial = socialPageContextStore.subscribe(bump);
    const unsubGeneral = generalPageMediaContextStore.subscribe(bump);
    return () => {
      unsubSocial();
      unsubGeneral();
    };
  }, []);

  useEffect(() => {
    if (prevNavRef.current && lastNavigation) {
      const social =
        resolveSocialPlatform(lastNavigation) ??
        resolveSocialPlatform(prevNavRef.current);
      const sameDocument = isSameDocumentUrl(prevNavRef.current, lastNavigation);
      const sameContent =
        !social &&
        isSameGeneralContentNavigation(prevNavRef.current, lastNavigation);
      if (!sameDocument && !sameContent) {
        browserMediaActionService.resetForNavigation(lastNavigation);
        qualityHandoffRef.current = null;
      }
    }
    prevNavRef.current = lastNavigation;
  }, [lastNavigation]);

  // Quality sheet confirm → Phase 1 create: consume CTA for the offered fingerprint.
  useEffect(() => {
    return registerQualitySelectionDownloadListener(() => {
      const handoff = qualityHandoffRef.current;
      const fp =
        handoff?.fingerprint ??
        browserMediaActionService.getState().mediaFingerprint;
      const tabId =
        handoff?.tabId ??
        browserMediaActionService.getActiveTabId() ??
        '__default__';
      if (fp) {
        browserMediaActionService.commitConsumed(tabId, fp, -1);
      }
      qualityHandoffRef.current = null;
    });
  }, []);

  // Quality sheet dismiss/cancel → restore AVAILABLE (not consumed).
  useEffect(() => {
    return registerQualitySelectionClosedListener(() => {
      const handoff = qualityHandoffRef.current;
      browserMediaActionService.endQualitySelection(handoff?.tabId);
      qualityHandoffRef.current = null;
    });
  }, []);

  const verifyCandidate = useCallback(
    async (
      media: NonNullable<typeof discovery.media>,
    ): Promise<MediaResolutionOutcome> => {
      if (
        browserMediaActionService.getVerifiedCandidateId() === media.id &&
        !media.url.toLowerCase().startsWith('blob:')
      ) {
        return classifyMediaResolutionOutcome({ resolvedSupported: true });
      }
      if (verifyingRef.current) {
        logGeneralDownloadTrace('RESOLUTION_JOINED', {
          reason: 'VERIFYING',
        });
        return classifyMediaResolutionOutcome({ verificationInFlight: true });
      }
      const status = browserMediaActionService.getState().status;
      if (status === 'preparing' || browserMediaActionService.isSelectionLocked()) {
        logGeneralDownloadTrace('RESOLUTION_JOINED', {
          reason: 'HANDOFF_IN_PROGRESS',
        });
        return classifyMediaResolutionOutcome({ verificationInFlight: true });
      }

      const pageUrlEarly = lastNavigation ?? media.pageUrl ?? null;
      const tabIdEarly =
        browserMediaActionService.getActiveTabId() ??
        useBrowserStore.getState().activeTabId ??
        '__default__';
      let executable = media;
      const rawUrl = media.finalUrl?.trim() || media.url?.trim() || '';
      const storeHttpCandidates = useMediaDetectionStore
        .getState()
        .detectedMedia.filter(
          (item) =>
            !item.url.toLowerCase().startsWith('blob:') &&
            !(item.finalUrl ?? '').toLowerCase().startsWith('blob:'),
        );
      const socialCtxEarly = socialPageContextStore.get(tabIdEarly);
      const generalCtxEarly = generalPageMediaContextStore.get(tabIdEarly);
      const httpCandidates = mergeEligibleWindowCandidates(
        {
          tabId: tabIdEarly,
          navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
          generation:
            socialCtxEarly?.contextGeneration ??
            generalCtxEarly?.pageGeneration ??
            0,
          platform:
            resolveSocialPlatform(pageUrlEarly ?? '') ?? 'general',
        },
        storeHttpCandidates,
      );
      if (rawUrl.toLowerCase().startsWith('blob:') || !rawUrl) {
        if (pageUrlEarly && resolveSocialPlatform(pageUrlEarly) && httpCandidates.length > 0) {
          const picked = selectCurrentMediaForActiveSocialTab({
            candidates: httpCandidates,
            tabId: tabIdEarly,
            navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
            pageUrl: pageUrlEarly,
          });
          if (picked.media) {
            executable = picked.media;
          }
        } else if (httpCandidates[0]) {
          executable = httpCandidates[0];
        }
      }

      const mediaUrl = executable.finalUrl?.trim() || executable.url?.trim() || '';
      const executableIsBlob =
        !mediaUrl || mediaUrl.toLowerCase().startsWith('blob:');
      if (executableIsBlob && httpCandidates.length === 0) {
        const mse = getMsePlaybackContext(pageUrlEarly);
        logMediaResolveTrace({
          tabId: tabIdEarly,
          platform: resolveSocialPlatform(pageUrlEarly ?? '') ?? 'general',
          generation:
            socialCtxEarly?.contextGeneration ??
            generalCtxEarly?.pageGeneration ??
            0,
          event: 'TRANSIENT_UNRESOLVED',
          candidateType: 'blob',
          rejectionReason: mse.msePlaybackActive
            ? 'PLATFORM_UNOBSERVABLE'
            : 'NO_FRESH_SOURCE',
        });
        return classifyMediaResolutionOutcome({
          hasCandidates: false,
          rejectionReason: mse.msePlaybackActive
            ? 'PLATFORM_UNOBSERVABLE'
            : 'NO_FRESH_SOURCE',
        });
      }

      const pageUrl = pageUrlEarly;
      if (!pageUrl) {
        return classifyMediaResolutionOutcome({ hasCandidates: httpCandidates.length > 0 });
      }

      const fingerprint = buildBrowserMediaFingerprint({
        pageUrl,
        mediaUrl: executableIsBlob ? (httpCandidates[0]?.url ?? pageUrl) : mediaUrl,
        platform: executable.websiteSource,
      });
      if (
        !executableIsBlob &&
        browserMediaActionService.isFingerprintConsumed(fingerprint)
      ) {
        return classifyMediaResolutionOutcome({
          staleToken: true,
          rejectionReason: 'STALE_CONTEXT',
        });
      }

      const tabId =
        browserMediaActionService.getActiveTabId() ??
        useBrowserStore.getState().activeTabId ??
        '__default__';
      const navigationEpoch = useMediaDetectionStore.getState().navigationEpoch;
      const socialPlatform = resolveSocialPlatform(pageUrl);
      const currentOffer = browserMediaActionService.getState();

      // Capture Phase 4A scope before async work — stale results must no-op.
      let socialScope: {
        contentIdentity: string;
        socialContextGeneration: number;
        ownershipConfidence: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null;
        activeCandidateIds: string[];
      } | null = null;

      // Capture Phase 5A/5B general scope — ownership from 5A, verify in 5B.
      let generalScope: {
        mediaIdentity: string;
        pageGeneration: number;
        ownershipConfidence: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null;
        activeCandidateIds: string[];
      } | null = null;

      if (socialPlatform) {
        socialPageContextStore.setActiveTab(tabId);
        socialPageContextStore.syncFromPageUrl({
          tabId,
          pageUrl,
          navigationEpoch,
        });
        const ctx = socialPageContextStore.get(tabId);
        const socialPick = selectCurrentMediaForActiveSocialTab({
          candidates:
            httpCandidates.length > 0
              ? httpCandidates
              : executableIsBlob
                ? []
                : [executable],
          tabId,
          navigationEpoch,
          pageUrl,
        });
        const contentIdentity =
          socialPick.group.currentContentIdentity ??
          ctx?.currentVisibleMediaIdentity ??
          (ctx?.canonicalContentId
            ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
            : null);
        if (!contentIdentity || !ctx) {
          // No stable social content yet — fall through to legacy verify.
          socialScope = null;
        } else {
          const rankedIds = socialPick.group.activeCandidateIds.filter((id) => {
            const match = httpCandidates.find((c) => c.id === id);
            return match && !match.url.toLowerCase().startsWith('blob:');
          });
          socialScope = {
            contentIdentity,
            socialContextGeneration: ctx.contextGeneration,
            ownershipConfidence: socialPick.group.confidence,
            activeCandidateIds:
              rankedIds.length > 0
                ? rankedIds
                : httpCandidates.map((c) => c.id).slice(0, 6),
          };
          logMediaResolveTrace({
            tabId,
            platform: ctx.platform,
            generation: ctx.contextGeneration,
            identityKind: contentIdentity,
            event: 'IDENTITY_READY',
            candidateType: 'http',
            outcome: socialPick.group.confidence,
          });
        }
      } else {
        generalPageMediaContextStore.setActiveTab(tabId);
        generalPageMediaContextStore.syncFromPageUrl({
          tabId,
          pageUrl,
          navigationEpoch,
        });
        const gctx = generalPageMediaContextStore.get(tabId);
        const generalPick = selectCurrentMediaForActiveGeneralTab({
          candidates:
            httpCandidates.length > 0
              ? httpCandidates
              : discovery.candidates.length
                ? discovery.candidates
                : executableIsBlob
                  ? []
                  : [media],
          tabId,
          navigationEpoch,
          pageUrl,
        });
        const mediaIdentity =
          generalPick.group.currentMediaIdentity ??
          gctx?.currentMediaIdentity ??
          `general:${pageUrl}`;
        if (gctx) {
          generalScope = {
            mediaIdentity,
            pageGeneration: gctx.pageGeneration,
            ownershipConfidence: generalPick.group.confidence,
            activeCandidateIds:
              generalPick.group.activeCandidateIds.length > 0
                ? generalPick.group.activeCandidateIds
                : [media.id],
          };
        }
      }

      const nextIdentity =
        socialScope?.contentIdentity ?? generalScope?.mediaIdentity ?? null;

      // Sticky AVAILABLE: same content (CDN/candidate churn) must not re-enter detecting.
      if (
        !shouldStartVerification({
          status: currentOffer.status,
          offerContentIdentity: currentOffer.contentIdentity,
          nextContentIdentity: nextIdentity,
          verifiedCandidateId: browserMediaActionService.getVerifiedCandidateId(),
          nextCandidateId: executable.id,
          selectionLocked: browserMediaActionService.isSelectionLocked(),
        })
      ) {
        if (currentOffer.status === 'verified') {
          return classifyMediaResolutionOutcome({ resolvedSupported: true });
        }
        return classifyMediaResolutionOutcome({ verificationInFlight: true });
      }

      verifyingRef.current = true;
      logBrowserCta('media_verify_start', {
        tabId: tabIdEarly,
        state: toBrowserMediaCtaState(browserMediaActionService.getState().status),
      });
      logAutomaticHandoff('MEDIA_VERIFY_AUTO_STARTED', {
        tabId: tabIdEarly,
        contentIdentityHash: hashHandoffIdentity(nextIdentity),
        candidateIdHash: hashHandoffIdentity(executable.id),
        ownershipConfidence:
          socialScope?.ownershipConfidence ??
          generalScope?.ownershipConfidence ??
          null,
        streamType: executable.streamType,
        container: executable.container ?? null,
      });
      // Never drop AVAILABLE → detecting for sticky same-content retention.
      if (
        !shouldRetainAvailableCta({
          status: currentOffer.status,
          offerContentIdentity: currentOffer.contentIdentity,
          nextContentIdentity: nextIdentity,
          nextOwnershipConfidence:
            socialScope?.ownershipConfidence ??
            generalScope?.ownershipConfidence ??
            null,
        })
      ) {
        browserMediaActionService.setDetecting(pageUrl);
      }
      const signal = browserMediaActionService.beginVerification();

      const retainOnTransientFailure = (): boolean => {
        const live = browserMediaActionService.getState();
        return shouldRetainAvailableCta({
          status: live.status === 'detecting' ? currentOffer.status : live.status,
          offerContentIdentity:
            live.contentIdentity ?? currentOffer.contentIdentity,
          nextContentIdentity: nextIdentity,
          nextOwnershipConfidence:
            socialScope?.ownershipConfidence ??
            generalScope?.ownershipConfidence ??
            null,
        });
      };

      const clearOrRetain = (): void => {
        if (retainOnTransientFailure()) {
          // Restore AVAILABLE if detecting briefly flipped status without clearing offer.
          const live = browserMediaActionService.getState();
          if (
            live.status === 'detecting' &&
            live.analysis &&
            live.mediaFingerprint
          ) {
            browserMediaActionService.setStatus('verified');
          }
          return;
        }
        browserMediaActionService.setStatus('idle');
      };

      try {
        const session = pendingMediaResolutionService.get();
        if (session && pendingMediaResolutionService.matchesPageUrl(pageUrl)) {
          const pendingResult = await tryCompletePageResolutionFromStore(session, signal);
          if (pendingResult?.ok) {
            if (socialScope && !isSocialScopeCurrent(tabId, navigationEpoch, socialScope)) {
              return classifyMediaResolutionOutcome({ staleToken: true });
            }
            browserMediaActionService.handoffVerified({
              pageUrl,
              media: pendingResult.media,
              analysis: pendingResult.analysis,
              requestContext: pendingResult.requestContext,
              mediaUrl: pendingResult.mediaUrl,
              autoShow: true,
            });
            pendingMediaResolutionService.clear();
            logMediaResolveTrace({
              tabId,
              event: 'OFFER_READY',
              outcome: 'RESOLVED_SUPPORTED',
            });
            return classifyMediaResolutionOutcome({ resolvedSupported: true });
          }
        }

        // Phase 4B social path — verify only 4A-owned candidates.
        if (socialScope) {
          const offerResult = await buildVerifiedSocialMediaOffer({
            scope: {
              tabId,
              navigationEpoch,
              socialContextGeneration: socialScope.socialContextGeneration,
              contentIdentity: socialScope.contentIdentity,
              ownershipConfidence: socialScope.ownershipConfidence,
            },
            candidates: httpCandidates.length > 0 ? httpCandidates : [executable],
            pageUrl,
            signal,
            activeCandidateIds:
              socialScope.activeCandidateIds.length > 0
                ? socialScope.activeCandidateIds
                : httpCandidates.map((c) => c.id).slice(0, 6),
          });

          if (signal.aborted) {
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (
            !shouldAcceptVerificationResult({
              resultTabId: tabId,
              activeTabId: browserMediaActionService.getActiveTabId(),
              resultNavigationEpoch: navigationEpoch,
              currentNavigationEpoch:
                useMediaDetectionStore.getState().navigationEpoch,
              resultContentIdentity: socialScope.contentIdentity,
              currentContentIdentity:
                socialPageContextStore.get(tabId)?.currentVisibleMediaIdentity ??
                (socialPageContextStore.get(tabId)?.canonicalContentId
                  ? `${socialPageContextStore.get(tabId)!.platform}:${socialPageContextStore.get(tabId)!.contentType}:${socialPageContextStore.get(tabId)!.canonicalContentId}`
                  : null),
              resultGeneration: socialScope.socialContextGeneration,
              currentGeneration:
                socialPageContextStore.get(tabId)?.contextGeneration ?? -1,
            })
          ) {
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
              scope: 'social',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (!isSocialScopeCurrent(tabId, navigationEpoch, socialScope)) {
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
              scope: 'social',
              reason: 'SCOPE_NOT_CURRENT',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          if (!offerResult.ok) {
            clearOrRetain();
            const outcome = classifyMediaResolutionOutcome({
              rejectionReason: offerResult.reason,
              hasCandidates: httpCandidates.length > 0,
              allBoundedCandidatesRejected:
                httpCandidates.length > 0 &&
                offerResult.reason !== 'NO_FRESH_SOURCE' &&
                offerResult.reason !== 'PROBE_FAILED' &&
                offerResult.reason !== 'STALE_SOCIAL_CONTEXT' &&
                offerResult.reason !== 'STALE_SOURCE_GENERATION',
            });
            logMediaResolveTrace({
              tabId,
              platform: socialPlatform,
              generation: socialScope.socialContextGeneration,
              identityKind: socialScope.contentIdentity,
              event:
                outcome.kind === 'PROVEN_UNSUPPORTED'
                  ? 'PROVEN_UNSUPPORTED'
                  : 'TRANSIENT_UNRESOLVED',
              rejectionReason: offerResult.reason,
              outcome: outcome.kind,
            });
            return outcome;
          }

          const preferred =
            offerResult.offer.variants.find(
              (v) => v.variantId === offerResult.offer.preferredVariantId,
            ) ?? offerResult.offer.variants.find((v) => v.downloadable);

          if (!preferred?.requestContext) {
            clearOrRetain();
            return classifyMediaResolutionOutcome({
              hasCandidates: true,
              allBoundedCandidatesRejected: true,
              rejectionReason: 'NO_FRESH_SOURCE',
            });
          }

          // Consumed check against fingerprint + content identity (signed path changes).
          const offerFp = buildBrowserMediaFingerprint({
            pageUrl,
            mediaUrl: preferred.executableUrl,
            platform: media.websiteSource,
          });
          if (
            browserMediaActionService.isFingerprintConsumed(offerFp) ||
            browserMediaActionService.isContentIdentityConsumed(
              socialScope.contentIdentity,
            )
          ) {
            browserMediaActionService.retainConsumedPresentation(
              socialScope.contentIdentity,
            );
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          browserMediaActionService.handoffVerified({
            pageUrl,
            media,
            analysis: offerResult.analysis,
            requestContext: preferred.requestContext,
            mediaUrl: preferred.executableUrl,
            autoShow: Boolean(pendingMediaResolutionService.get()),
            contentIdentity: socialScope.contentIdentity,
            variantIdentity: preferred.resourceIdentity,
          });
          logMediaResolveTrace({
            tabId,
            platform: socialPlatform,
            generation: socialScope.socialContextGeneration,
            identityKind: socialScope.contentIdentity,
            event: 'OFFER_READY',
            outcome: 'RESOLVED_SUPPORTED',
          });
          logAutomaticHandoff('MEDIA_VERIFY_SUPPORTED', {
            tabId,
            contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
            transport: preferred.transport,
          });
          logAutomaticHandoff('MEDIA_CTA_AVAILABLE', {
            tabId,
            contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
          });
          return classifyMediaResolutionOutcome({ resolvedSupported: true });
        }

        // Phase 5B general path — verify only 5A-owned candidates.
        if (generalScope) {
          if (
            !isGeneralScopeCurrent(tabId, navigationEpoch, generalScope)
          ) {
            clearOrRetain();
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          logGeneralVerifyTrace('VERIFY_STARTED', {
            tabId,
            pageGeneration: generalScope.pageGeneration,
            mediaIdentityHash: hashSafeId(generalScope.mediaIdentity),
          });
          const offerResult = await buildVerifiedGeneralMediaOffer({
            scope: {
              tabId,
              navigationEpoch,
              pageGeneration: generalScope.pageGeneration,
              mediaIdentity: generalScope.mediaIdentity,
              ownershipConfidence: generalScope.ownershipConfidence,
            },
            candidates: httpCandidates.length > 0 ? httpCandidates : [media],
            pageUrl,
            signal,
            activeCandidateIds:
              generalScope.activeCandidateIds.length > 0
                ? generalScope.activeCandidateIds
                : httpCandidates.map((c) => c.id).slice(0, 6),
          });

          if (signal.aborted) {
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (
            !shouldAcceptVerificationResult({
              resultTabId: tabId,
              activeTabId: browserMediaActionService.getActiveTabId(),
              resultNavigationEpoch: navigationEpoch,
              currentNavigationEpoch:
                useMediaDetectionStore.getState().navigationEpoch,
              resultContentIdentity: generalScope.mediaIdentity,
              currentContentIdentity:
                generalPageMediaContextStore.get(tabId)?.currentMediaIdentity ??
                null,
              resultGeneration: generalScope.pageGeneration,
              currentGeneration:
                generalPageMediaContextStore.get(tabId)?.pageGeneration ?? -1,
            })
          ) {
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
              scope: 'general',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (!isGeneralScopeCurrent(tabId, navigationEpoch, generalScope)) {
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
              scope: 'general',
              reason: 'SCOPE_NOT_CURRENT',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          if (!offerResult.ok) {
            logGeneralVerifyTrace('VERIFY_REJECTED', {
            tabId,
            pageGeneration: generalScope.pageGeneration,
            mediaIdentityHash: hashSafeId(generalScope.mediaIdentity),
            rejectionReason: offerResult.reason,
          });
            const isProvenUnsupported =
              offerResult.reason === 'DRM_UNSUPPORTED' ||
              offerResult.reason === 'DASH_UNSUPPORTED' ||
              offerResult.reason === 'LIVE_HLS_UNSUPPORTED' ||
              offerResult.reason === 'VIDEO_ONLY_UNSUPPORTED' ||
              offerResult.reason === 'UNSUPPORTED_TRANSPORT';
            logAutomaticHandoff(
              isProvenUnsupported ? 'MEDIA_VERIFY_UNSUPPORTED' : 'MEDIA_VERIFY_REJECTED',
              {
                tabId,
                contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
                rejectionReason: offerResult.reason,
              },
            );
            clearOrRetain();
            return classifyMediaResolutionOutcome({
              rejectionReason: offerResult.reason,
              hasCandidates: httpCandidates.length > 0,
              allBoundedCandidatesRejected:
                httpCandidates.length > 0 &&
                offerResult.reason !== 'NO_FRESH_SOURCE' &&
                offerResult.reason !== 'PROBE_FAILED' &&
                offerResult.reason !== 'STALE_PAGE_GENERATION' &&
                offerResult.reason !== 'STALE_SOURCE_GENERATION',
            });
          }

          const preferred =
            offerResult.offer.variants.find(
              (v) => v.variantId === offerResult.offer.preferredVariantId,
            ) ?? offerResult.offer.variants.find((v) => v.downloadable);

          if (!preferred?.requestContext) {
            clearOrRetain();
            return classifyMediaResolutionOutcome({
              hasCandidates: true,
              allBoundedCandidatesRejected: true,
              rejectionReason: 'NO_FRESH_SOURCE',
            });
          }

          const offerFp = buildBrowserMediaFingerprint({
            pageUrl,
            mediaUrl: preferred.executableUrl,
            platform: media.websiteSource,
          });
          if (
            browserMediaActionService.isFingerprintConsumed(offerFp) ||
            browserMediaActionService.isContentIdentityConsumed(
              generalScope.mediaIdentity,
            )
          ) {
            browserMediaActionService.retainConsumedPresentation(
              generalScope.mediaIdentity,
            );
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          browserMediaActionService.handoffVerified({
            pageUrl,
            media,
            analysis: offerResult.analysis,
            requestContext: preferred.requestContext,
            mediaUrl: preferred.executableUrl,
            autoShow: Boolean(pendingMediaResolutionService.get()),
            contentIdentity: generalScope.mediaIdentity,
            variantIdentity: preferred.resourceIdentity,
          });
          logMediaResolveTrace({
            tabId,
            generation: generalScope.pageGeneration,
            identityKind: generalScope.mediaIdentity,
            event: 'OFFER_READY',
            outcome: 'RESOLVED_SUPPORTED',
          });
          logGeneralVerifyTrace('VERIFY_SUCCEEDED', {
            tabId,
            pageGeneration: generalScope.pageGeneration,
            mediaIdentityHash: hashSafeId(generalScope.mediaIdentity),
          });
          logGeneralVerifyTrace('OFFER_READY', {
            tabId,
            pageGeneration: generalScope.pageGeneration,
            mediaIdentityHash: hashSafeId(generalScope.mediaIdentity),
          });
          logAutomaticHandoff('MEDIA_VERIFY_SUPPORTED', {
            tabId,
            contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
            transport: preferred.transport,
          });
          logAutomaticHandoff('MEDIA_CTA_AVAILABLE', {
            tabId,
            contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
          });
          return classifyMediaResolutionOutcome({ resolvedSupported: true });
        }

        if (executableIsBlob || !isSafeMediaUrl(mediaUrl)) {
          return classifyMediaResolutionOutcome({
            hasCandidates: httpCandidates.length > 0,
            rejectionReason: executableIsBlob ? 'BLOB_ONLY' : 'NOT_MEDIA',
            allBoundedCandidatesRejected: httpCandidates.length === 0,
          });
        }

        const requestContext = await buildRequestContextFromDetectedMedia({
          mediaUrl,
          pageUrl,
          requiresCookies: media.requiresCookies,
          requiredHeaders: media.requiredHeaders,
        });

        if (signal.aborted) {
          return classifyMediaResolutionOutcome({ staleToken: true });
        }

        const verification = await verifyMediaCandidate(mediaUrl, {
          requestContext,
          signal,
        });

        if (signal.aborted) {
          return classifyMediaResolutionOutcome({ staleToken: true });
        }

        if (!verification.ok) {
          clearOrRetain();
          return classifyMediaResolutionOutcome({
            hasCandidates: true,
            rejectionReason: 'PROBE_FAILED',
          });
        }

        const pendingSession = pendingMediaResolutionService.get();
        const analysis = buildAnalysisFromVerification(verification, media, pageUrl);
        const hasDownloadable =
          analysis.downloadable ||
          (analysis.variants ?? []).some((variant) => variant.downloadable);

        if (!hasDownloadable) {
          clearOrRetain();
          logBrowserCta('media_verify_unsupported', {
            tabId: tabIdEarly,
            result: 'NOT_MEDIA',
          });
          return classifyMediaResolutionOutcome({
            hasCandidates: true,
            allBoundedCandidatesRejected: true,
            rejectionReason: 'NOT_MEDIA',
          });
        }

        if (pendingSession && pendingMediaResolutionService.matchesPageUrl(pageUrl)) {
          const completed = await completePageResolutionWithMedia(
            pendingSession,
            media,
            signal,
          );
          if (completed.ok) {
            browserMediaActionService.handoffVerified({
              pageUrl,
              media: completed.media,
              analysis: completed.analysis,
              requestContext: completed.requestContext,
              mediaUrl: completed.mediaUrl,
              autoShow: true,
            });
            pendingMediaResolutionService.clear();
            return classifyMediaResolutionOutcome({ resolvedSupported: true });
          }
        }

        browserMediaActionService.handoffVerified({
          pageUrl,
          media,
          analysis,
          requestContext,
          mediaUrl: verification.finalUrl,
          autoShow: Boolean(pendingSession),
        });
        logBrowserCta('media_verify_success', {
          tabId: tabIdEarly,
          state: 'AVAILABLE',
        });
        return classifyMediaResolutionOutcome({ resolvedSupported: true });
      } catch {
        if (!signal.aborted) {
          clearOrRetain();
        }
        return classifyMediaResolutionOutcome({
          rejectionReason: 'PROBE_FAILED',
          hasCandidates: true,
        });
      } finally {
        verifyingRef.current = false;
        browserMediaActionService.cancelVerification();
      }
    },
    [lastNavigation, discovery.candidates],
  );

  useEffect(() => {
    if (isHome || !discovery.media) {
      return;
    }

    const pageUrl = lastNavigation ?? discovery.media.pageUrl ?? null;
    const tabId =
      browserMediaActionService.getActiveTabId() ??
      useBrowserStore.getState().activeTabId ??
      '__default__';

    // Feed swipe on same document: drop stale Video A only when B is a strong owner.
    if (pageUrl && resolveSocialPlatform(pageUrl)) {
      const ctx = socialPageContextStore.get(tabId);
      const socialPick = selectCurrentMediaForActiveSocialTab({
        candidates: discovery.candidates.length
          ? discovery.candidates
          : [discovery.media],
        tabId,
        navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
        pageUrl,
      });
      const nextIdentity =
        socialPick.group.currentContentIdentity ??
        ctx?.currentVisibleMediaIdentity ??
        (ctx?.canonicalContentId
          ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
          : null);
      const nextConfidence = socialPick.group.confidence;
      if (
        nextIdentity &&
        shouldInvalidateCurrentMedia({
          priorContentIdentity:
            browserMediaActionService.getState().contentIdentity,
          nextContentIdentity: nextIdentity,
          nextOwnershipConfidence: nextConfidence,
          handoffOrSelectionLocked:
            browserMediaActionService.isSelectionLocked() ||
            browserMediaActionService.getState().status === 'preparing',
        })
      ) {
        browserMediaActionService.invalidateStaleSocialOffer(
          nextIdentity,
          nextConfidence,
        );
      }
    } else if (pageUrl) {
      // General pipeline: same sticky invalidation rule.
      const gPick = selectCurrentMediaForActiveGeneralTab({
        candidates: discovery.candidates.length
          ? discovery.candidates
          : [discovery.media],
        tabId,
        navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
        pageUrl,
      });
      const nextIdentity =
        gPick.group.currentMediaIdentity ??
        generalPageMediaContextStore.get(tabId)?.currentMediaIdentity ??
        null;
      if (
        nextIdentity &&
        shouldInvalidateCurrentMedia({
          priorContentIdentity:
            browserMediaActionService.getState().contentIdentity,
          nextContentIdentity: nextIdentity,
          nextOwnershipConfidence: gPick.group.confidence,
          handoffOrSelectionLocked:
            browserMediaActionService.isSelectionLocked() ||
            browserMediaActionService.getState().status === 'preparing',
        })
      ) {
        browserMediaActionService.invalidateStaleSocialOffer(
          nextIdentity,
          gPick.group.confidence,
        );
      }
    }

    const verifiedId = browserMediaActionService.getVerifiedCandidateId();
    if (verifiedId && verifiedId === discovery.media.id) {
      return;
    }

    const status = browserMediaActionService.getState().status;
    if (status === 'preparing' || browserMediaActionService.isSelectionLocked()) {
      return;
    }

    const mse = getMsePlaybackContext(lastNavigation);
    const shouldVerify =
      discovery.downloadable ||
      (mse.msePlaybackActive && discovery.media.confidence >= 0.42) ||
      (!discovery.media.isDrm &&
        (discovery.media.category === 'video' ||
          discovery.media.category === 'stream' ||
          discovery.media.confidence >= 0.42));

    if (!shouldVerify) {
      return;
    }

    void verifyCandidate(discovery.media);
  }, [
    discovery.media,
    discovery.candidates,
    discovery.downloadable,
    isHome,
    lastNavigation,
    verifyCandidate,
  ]);

  const selection = useMemo(
    () =>
      actionState.analysis
        ? normalizeAnalysisToSelection(actionState.analysis)
        : null,
    [actionState.analysis],
  );

  const downloadableOptions = useMemo(
    () => selectVerifiedStandaloneQualities(selection?.options),
    [selection],
  );

  const hasMultipleQualities = downloadableOptions.length > 1;
  const expanded = !actionState.dismissed && !actionState.autoShownOnce
    ? actionState.status === 'verified'
    : !actionState.dismissed;

  const liveOwner = useMemo(() => {
    const pageUrl = currentUrl ?? lastNavigation;
    const tabId =
      browserMediaActionService.getActiveTabId() ??
      useBrowserStore.getState().activeTabId ??
      '__default__';
    if (!pageUrl) {
      return { identity: null as string | null, confidence: null as 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null };
    }
    if (resolveSocialPlatform(pageUrl)) {
      const ctx = socialPageContextStore.get(tabId);
      const identity =
        ctx?.currentVisibleMediaIdentity ??
        (ctx?.canonicalContentId
          ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
          : null);
      return {
        identity,
        confidence: resolveLivePresentationOwnership({
          canonicalContentId: ctx?.canonicalContentId,
          identityConfidence: ctx?.identityConfidence,
          intersectionRatio: ctx?.activeVideoIntersectionRatio,
          recentlyPlayed: ctx?.activeVideoRecentlyPlayed,
        }),
      };
    }
    const gctx = generalPageMediaContextStore.get(tabId);
    const identity = gctx?.currentMediaIdentity ?? null;
    const storedStrength =
      gctx?.ownerStrength === 'STRONG' || gctx?.ownerStrength === 'MEDIUM'
        ? gctx.ownerStrength
        : null;
    return {
      identity,
      confidence:
        storedStrength ??
        resolveLivePresentationOwnership({
          canonicalContentId: identity,
          identityConfidence: identity ? 'MEDIUM' : null,
          intersectionRatio: gctx?.activeVideoIntersectionRatio ?? null,
          recentlyPlayed: gctx?.activeVideoRecentlyPlayed,
        }),
    };
  }, [currentUrl, lastNavigation, ownerRevision]);

  const presentation = useMemo(
    () =>
      buildBrowserDownloadPresentation({
        actionState,
        activeTabId: browserMediaActionService.getActiveTabId(),
        isHome,
        hasBrowserError: Boolean(browserError),
        overlayBlocking,
        currentPageUrl: currentUrl ?? lastNavigation,
        hasDownloadableOptions: downloadableOptions.length > 0,
        liveContentIdentity: liveOwner.identity,
        liveOwnershipConfidence: liveOwner.confidence,
        liveIdentityConsumed: browserMediaActionService.isContentIdentityConsumed(
          liveOwner.identity,
        ),
      }),
    [
      actionState,
      browserError,
      currentUrl,
      downloadableOptions.length,
      isHome,
      lastNavigation,
      liveOwner.confidence,
      liveOwner.identity,
      overlayBlocking,
    ],
  );

  // Browser CTA offers download entry only — not download progress.
  const visible = presentation.showCard;

  useEffect(() => {
    if (visible && expanded && actionState.status === 'verified' && !actionState.autoShownOnce) {
      browserMediaActionService.markAutoShown();
    }
  }, [actionState.autoShownOnce, actionState.status, expanded, visible]);

  // Sanitized DEV diagnostic — fires once per content identity when the
  // shell decisively renders the unsupported-format state to the user.
  const unsupportedPresentedRef = useRef<string | null>(null);
  useEffect(() => {
    if (presentation.shellState !== 'UNSUPPORTED_CURRENT_CONTENT') {
      unsupportedPresentedRef.current = null;
      return;
    }
    const key = actionState.contentIdentity ?? liveOwner.identity ?? presentation.pageUrl;
    if (!key || unsupportedPresentedRef.current === key) {
      return;
    }
    unsupportedPresentedRef.current = key;
    logAutomaticHandoff('MEDIA_UNSUPPORTED_PRESENTED', {
      tabId: presentation.tabId,
      contentIdentityHash: hashHandoffIdentity(key),
    });
  }, [
    actionState.contentIdentity,
    liveOwner.identity,
    presentation.pageUrl,
    presentation.shellState,
    presentation.tabId,
  ]);

  const dismiss = useCallback(() => {
    browserMediaActionService.dismiss();
  }, []);

  const download = useCallback(async (): Promise<{
    ok: boolean;
    downloadId?: string;
    outcome?: MediaResolutionOutcome;
  }> => {
    const captureToken = (): DownloadResolutionToken => {
      const tabId =
        browserMediaActionService.getActiveTabId() ??
        useBrowserStore.getState().activeTabId ??
        '__default__';
      const pageUrl =
        browserMediaActionService.getState().pageUrl ??
        useMediaDetectionStore.getState().lastNavigation;
      const social = socialPageContextStore.get(tabId);
      const general = generalPageMediaContextStore.get(tabId);
      return {
        tabId,
        navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
        generation: social?.contextGeneration ?? general?.pageGeneration ?? 0,
        contentIdentity:
          browserMediaActionService.getState().contentIdentity ??
          social?.currentVisibleMediaIdentity ??
          general?.currentMediaIdentity ??
          null,
      };
    };

    const token = captureToken();
    logGeneralDownloadTrace('TAP', {
      tabId: token.tabId,
      navigationEpoch: token.navigationEpoch,
      pageGeneration: token.generation,
      mediaIdentityHash: hashSafeId(token.contentIdentity),
    });
    logBrowserCta('media_action_download', {
      tabId: token.tabId,
      state: toBrowserMediaCtaState(browserMediaActionService.getState().status),
    });

    // Phase 2: Download is only actionable after background verification.
    // Do not run a user-facing Analyze / verify-on-first-tap step.
    const statusAtTap = browserMediaActionService.getState().status;
    if (statusAtTap !== 'verified') {
      if (statusAtTap === 'preparing' || browserMediaActionService.isSelectionLocked()) {
        return {
          ok: false,
          outcome: classifyMediaResolutionOutcome({ verificationInFlight: true }),
        };
      }
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({
          staleToken: true,
          rejectionReason: 'NOT_AVAILABLE',
        }),
      };
    }

    if (!isDownloadResolutionTokenCurrent(token, captureToken())) {
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({ staleToken: true }),
      };
    }

    // Multi-quality: lock sheet (not handoff) — cancel must keep AVAILABLE.
    if (hasMultipleQualities) {
      const tabId =
        browserMediaActionService.getActiveTabId() ??
        useBrowserStore.getState().activeTabId ??
        '__default__';
      const navigationEpoch = useMediaDetectionStore.getState().navigationEpoch;
      const pageUrl =
        browserMediaActionService.getState().pageUrl ??
        useMediaDetectionStore.getState().lastNavigation;
      const socialPlatform = pageUrl ? resolveSocialPlatform(pageUrl) : null;
      const lock = browserMediaActionService.beginQualitySelection({
        navigationEpoch,
        pageGeneration: socialPlatform
          ? null
          : (generalPageMediaContextStore.get(tabId)?.pageGeneration ?? null),
        socialContextGeneration: socialPlatform
          ? (socialPageContextStore.get(tabId)?.contextGeneration ?? null)
          : null,
      });
      if (lock.outcome !== 'LOCKED') {
        return {
          ok: false,
          outcome: classifyMediaResolutionOutcome({ verificationInFlight: true }),
        };
      }
      qualityHandoffRef.current = {
        tabId: lock.tabId,
        fingerprint: lock.fingerprint,
      };
      const sourceUrl =
        browserMediaActionService.getState().mediaUrl ??
        browserMediaActionService.getState().analysis?.finalUrl ??
        '';
      const ctx = browserMediaActionService.getState().requestContext;
      await options.onOpenQualitySheet?.(sourceUrl, {
        referer: ctx?.referer,
        requestContext: ctx,
      });
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({ resolvedSupported: true }),
      };
    }

    if (!isDownloadResolutionTokenCurrent(token, captureToken())) {
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({ staleToken: true }),
      };
    }

    // Single-variant: atomic claim BEFORE any await (closes double-tap window).
    const claim = browserMediaActionService.claimForHandoff();
    if (claim.outcome !== 'CLAIMED') {
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({
          verificationInFlight: claim.outcome === 'ALREADY_IN_PROGRESS',
          staleToken: claim.outcome === 'STALE',
        }),
      };
    }

    logBrowserCta('enqueue_started', {
      tabId: claim.tabId,
      fingerprintHash: fingerprintDiagHash(claim.fingerprint),
      handoffGeneration: claim.handoffGeneration,
      state: 'HANDOFF_IN_PROGRESS',
    });

    try {
      const defaultOption = selectDefaultQualityOption(
        normalizeAnalysisToSelection(claim.analysis).options,
      );
      // Phase 5C — only wire Phase 4C social refresh identity on social pages.
      // General media must not invent socialContextGeneration.
      const socialPlatform = claim.pageUrl
        ? resolveSocialPlatform(claim.pageUrl)
        : null;
      const socialSourceIdentity =
        socialPlatform && claim.contentIdentity && claim.variantIdentity
          ? {
              contentIdentity: claim.contentIdentity,
              variantIdentity: claim.variantIdentity,
              tabId: claim.tabId,
              pageUrl: claim.pageUrl,
              navigationEpoch: useMediaDetectionStore.getState().navigationEpoch,
              socialContextGeneration:
                socialPageContextStore.get(claim.tabId)?.contextGeneration ?? null,
            }
          : null;
      const result = await enqueueBrowserMediaDownload({
        analysis: claim.analysis,
        requestContext: claim.requestContext,
        selectedOptionId: defaultOption?.id ?? null,
        fingerprint: claim.fingerprint,
        socialSourceIdentity,
      });

      if (!result.ok) {
        logBrowserCta('enqueue_failed', {
          tabId: claim.tabId,
          fingerprintHash: fingerprintDiagHash(claim.fingerprint),
          handoffGeneration: claim.handoffGeneration,
          result: 'immediate_failure',
        });
        logBrowserCta('media_handoff_failure', {
          tabId: claim.tabId,
          fingerprintHash: fingerprintDiagHash(claim.fingerprint),
          handoffGeneration: claim.handoffGeneration,
          result: 'immediate_failure',
        });
        logGeneralDownloadTrace('NETWORK_FAILURE', {
          tabId: claim.tabId,
          reason: 'PROBE_FAILED',
        });
        browserMediaActionService.releaseHandoff(
          claim.tabId,
          claim.fingerprint,
          claim.handoffGeneration,
          result.message,
        );
        return {
          ok: false,
          outcome: classifyMediaResolutionOutcome({
            rejectionReason: 'PROBE_FAILED',
            hasCandidates: true,
          }),
        };
      }

      logBrowserCta('enqueue_succeeded', {
        tabId: claim.tabId,
        fingerprintHash: fingerprintDiagHash(claim.fingerprint),
        handoffGeneration: claim.handoffGeneration,
        result: 'admitted',
      });
      logBrowserCta('media_handoff_success', {
        tabId: claim.tabId,
        fingerprintHash: fingerprintDiagHash(claim.fingerprint),
        handoffGeneration: claim.handoffGeneration,
        result: 'admitted',
      });
      logBrowserCta('media_cta_consumed', {
        tabId: claim.tabId,
        fingerprintHash: fingerprintDiagHash(claim.fingerprint),
        state: 'CONSUMED',
      });

      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        result.downloadId,
      );
      logGeneralDownloadTrace('ENQUEUE_ACCEPTED', {
        tabId: claim.tabId,
      });
      options.onDownloadStarted?.(result.downloadId);
      return { ok: true, downloadId: result.downloadId };
    } catch {
      logBrowserCta('enqueue_failed', {
        tabId: claim.tabId,
        fingerprintHash: fingerprintDiagHash(claim.fingerprint),
        handoffGeneration: claim.handoffGeneration,
        result: 'exception',
      });
      logBrowserCta('media_handoff_failure', {
        tabId: claim.tabId,
        fingerprintHash: fingerprintDiagHash(claim.fingerprint),
        handoffGeneration: claim.handoffGeneration,
        result: 'exception',
      });
      browserMediaActionService.releaseHandoff(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'Could not start download.',
      );
      return {
        ok: false,
        outcome: classifyMediaResolutionOutcome({
          rejectionReason: 'PROBE_FAILED',
          hasCandidates: true,
        }),
      };
    }
  }, [hasMultipleQualities, options]);

  const viewDownloads = useCallback(() => {
    navigation.navigate(routePaths.downloads);
  }, []);

  const openLibrary = useCallback(() => {
    navigation.navigate(routePaths.library);
  }, []);

  const ctaState = toBrowserMediaCtaState(actionState.status);

  return {
    ...actionState,
    visible,
    expanded,
    platformLabel: presentation.title,
    metaLine: presentation.metaLine,
    title: presentation.title,
    thumbnailUrl: presentation.thumbnailUri,
    audioLabel: presentation.audioLabel,
    format: presentation.format,
    sizeLabel: presentation.sizeLabel,
    qualityLabel: presentation.qualityLabel,
    eyebrow: presentation.eyebrow,
    buttonLabel: presentation.buttonLabel,
    presentation,
    hasMultipleQualities,
    downloadable:
      downloadableOptions.length > 0 &&
      actionState.status === 'verified' &&
      !actionState.selectionLocked &&
      presentation.isEligible,
    ctaState,
    dismiss,
    download,
    viewDownloads,
    openLibrary,
  };
}

function isSocialScopeCurrent(
  tabId: string,
  navigationEpoch: number,
  scope: {
    contentIdentity: string;
    socialContextGeneration: number;
  },
): boolean {
  const ctx = socialPageContextStore.get(tabId);
  if (!ctx) {
    return false;
  }
  if (ctx.navigationEpoch !== navigationEpoch) {
    return false;
  }
  if (ctx.contextGeneration !== scope.socialContextGeneration) {
    return false;
  }
  const identity =
    ctx.canonicalContentId != null
      ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
      : ctx.currentVisibleMediaIdentity;
  if (identity && identity !== scope.contentIdentity) {
    return false;
  }
  return true;
}

function isGeneralScopeCurrent(
  tabId: string,
  navigationEpoch: number,
  scope: {
    mediaIdentity: string;
    pageGeneration: number;
  },
): boolean {
  const ctx = generalPageMediaContextStore.get(tabId);
  if (!ctx) {
    return false;
  }
  if (ctx.navigationEpoch !== navigationEpoch) {
    return false;
  }
  if (ctx.pageGeneration !== scope.pageGeneration) {
    return false;
  }
  if (
    ctx.currentMediaIdentity &&
    scope.mediaIdentity &&
    ctx.currentMediaIdentity !== scope.mediaIdentity
  ) {
    return false;
  }
  return true;
}
