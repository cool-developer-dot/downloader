import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { selectIsHome, selectBrowserError, useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { buildAnalysisFromVerification } from '@/downloads/analyze/analyze-from-verification';
import { normalizeAnalysisToSelection } from '@/downloads/quality';
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
import {
  classifyMsePlayback,
  getMsePlaybackContext,
  getMsePlaybackState,
  isSplitPlayerFile,
} from '@/media-detection/engine/mse-playback-context';
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
  isOfferedSourceRejectedNow,
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

import type { VerifyRerunBudget } from './cta-persistence';
import {
  offerNavigationReset,
  shouldAcceptVerificationResult,
  shouldInvalidateCurrentMedia,
  shouldRetainAvailableCta,
  shouldStartVerification,
  takeVerifyRerun,
} from './cta-persistence';
import { browserMediaActionService } from './browser-media-action.service';
import type { BrowserMediaActionState } from './browser-media-action.types';
import { toBrowserMediaCtaState } from './browser-media-action.types';
import type { V2DuplicateOutcome } from '@/downloads/v2';

import { enqueueBrowserMediaDownload } from './browser-media-download.service';
import {
  buildBrowserDownloadPresentation,
  resolveConsumedDownloadNotice,
  resolveLivePresentationOwnership,
  resolveOfferDuplicateNotice,
  type BrowserDownloadPresentation,
} from './browser-download-presentation';
import { useDownloadsStore } from '@/store/downloads';
import {
  fingerprintDiagHash,
  logBrowserCta,
} from './browser-cta-diagnostics';
import { ensureConsumedReleaseOnFailure } from './consumed-release';
import { buildBrowserMediaFingerprint } from './media-fingerprint';
import {
  classifyMediaResolutionOutcome,
  isDownloadResolutionTokenCurrent,
  type DownloadResolutionToken,
  type MediaResolutionOutcome,
} from './media-resolution-outcome';
import { logMediaResolveTrace } from './media-resolve-diagnostics';
import { recordVerificationOutcome } from './pipeline-trace';
import { pickOfferedQualityOption } from './offered-option';
import {
  pipelineRejectionFor,
  recordPipelineOutcome,
  traceCtaPresentation,
} from '@/media-detection/pipeline/pipeline-outcome';
import { findExistingDownload } from '@/downloads/v2/handoff';
import { mergeEligibleWindowCandidates } from '@/media-detection/observation/candidate-observation-window';
import { resolveSplitPair, splitPairAnalysis } from '@/media-detection/pipeline/split-tracks';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { toV2RequestContext } from '@/downloads/v2/enqueue-request';
import {
  selectVerifiedStandaloneQualities,
} from './verified-quality-options';

/** Consecutive re-runs allowed for the same media, owner and page after a verification the page overtook. */
const MAX_VERIFY_RERUNS = 3;
/** Wait before verifying again after a temporary network/server failure. */
const TRANSIENT_RETRY_MS = 3_000;
/**
 * How long a newly current video reads "Detecting video…" while nothing about it is known yet (no offer, no
 * verdict). Detection usually answers in 2–4 s; a video still unanswered after this shows nothing rather than a
 * detection that never ends. A not-yet-final negative verdict keeps it detecting until that verdict settles.
 */
const DETECTING_WINDOW_MS = 10_000;
/**
 * A verification of the current video that starts late (a slow page requests its media only after this window) shows
 * "Detecting video…" while it runs, up to this long after the video became current — never an endless detection.
 */
const DETECTING_MAX_MS = 30_000;

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
    downloadId?: string | null;
    /** True when nothing new was started. */
    deduped?: boolean;
    /** DUPLICATE: the same video is already downloading, or already saved (library or VidoraX gallery copy). */
    duplicate?: V2DuplicateOutcome | null;
    outcome?: MediaResolutionOutcome;
  }>;
  viewDownloads: () => void;
  openLibrary: () => void;
};

/**
 * Unified Browser media-action layer: correlate → verify → download CTA.
 * CTA is an entry point only — hide after successful Phase 1 enqueue.
 */
/** The content identity of the video the page on this tab shows now (social or general context), or null. */
function liveMediaIdentityOf(tabId: string, pageUrl: string | null | undefined): string | null {
  if (pageUrl && resolveSocialPlatform(pageUrl)) {
    const ctx = socialPageContextStore.get(tabId);
    return (
      ctx?.currentVisibleMediaIdentity ??
      (ctx?.canonicalContentId ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}` : null)
    );
  }
  return generalPageMediaContextStore.get(tabId)?.currentMediaIdentity ?? null;
}

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
  /** A verification trigger arrived while another verification was running. */
  const rerunRequestedRef = useRef(false);
  const rerunBudgetRef = useRef<VerifyRerunBudget>({ key: '', count: 0 });
  const [verifyRevision, setVerifyRevision] = useState(0);

  /**
   * Looks at the page again after a verification that the page overtook. Bounded per media/owner/page, so a page
   * whose state keeps cancelling verification cannot keep one running forever.
   */
  const scheduleVerifyRerun = useCallback((key: string) => {
    const next = takeVerifyRerun(rerunBudgetRef.current, key, MAX_VERIFY_RERUNS);
    rerunBudgetRef.current = next.budget;
    if (next.allowed) {
      setVerifyRevision((n) => n + 1);
    }
  }, []);
  const prevNavRef = useRef<string | null>(null);
  const qualityHandoffRef = useRef<{
    tabId: string;
    fingerprint: string;
  } | null>(null);

  // Verdicts and duplicate answers change the service without changing the offer state object.
  const [serviceRevision, setServiceRevision] = useState(0);
  useEffect(() => {
    return browserMediaActionService.subscribe(() => {
      setActionState(browserMediaActionService.getState());
      setServiceRevision((n) => n + 1);
    });
  }, []);

  // A download that failed for want of a fresh link gives its video back to the page's offer.
  useEffect(() => {
    ensureConsumedReleaseOnFailure();
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
    const previous = prevNavRef.current;
    const both = previous && lastNavigation ? { previous, next: lastNavigation } : null;
    const social = both ? (resolveSocialPlatform(both.next) ?? resolveSocialPlatform(both.previous)) : null;
    const reset = offerNavigationReset({
      previous,
      next: lastNavigation,
      nextIsHome: selectIsHome(useBrowserStore.getState()),
      sameDocument: both != null && isSameDocumentUrl(both.previous, both.next),
      sameContent: both != null && !social && isSameGeneralContentNavigation(both.previous, both.next),
    });
    if (reset) {
      browserMediaActionService.resetForNavigation(lastNavigation);
      qualityHandoffRef.current = null;
    }
    prevNavRef.current = lastNavigation;
  }, [lastNavigation]);

  // Quality sheet confirm → Phase 1 create: consume CTA for the offered fingerprint.
  useEffect(() => {
    return registerQualitySelectionDownloadListener((created) => {
      const handoff = qualityHandoffRef.current;
      const fp =
        handoff?.fingerprint ??
        browserMediaActionService.getState().mediaFingerprint;
      const tabId =
        handoff?.tabId ??
        browserMediaActionService.getActiveTabId() ??
        '__default__';
      if (fp) {
        browserMediaActionService.commitConsumed(
          tabId,
          fp,
          -1,
          created?.downloadId ?? null,
          created?.duplicate ?? null,
        );
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
      ownershipKey: string,
    ): Promise<MediaResolutionOutcome> => {
      if (
        browserMediaActionService.getVerifiedCandidateId() === media.id &&
        !media.url.toLowerCase().startsWith('blob:')
      ) {
        return classifyMediaResolutionOutcome({ resolvedSupported: true });
      }
      if (verifyingRef.current) {
        // Not dropped: the running verification looks at the page again when it ends (see its finally).
        rerunRequestedRef.current = true;
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

      // Phase 11B — what the blob/MediaSource player on this page amounts to. Protection is decided
      // before anything is verified or offered, so an encrypted player can never borrow an unrelated
      // HTTP(S) request from the same page and be published as downloadable.
      const mseState = getMsePlaybackState(tabIdEarly);
      const mseResolution = classifyMsePlayback({
        state: mseState,
        hasWholeSourceCandidate: !executableIsBlob || httpCandidates.length > 0,
        hasManifestCandidate: httpCandidates.some(isManifestCandidate),
      });
      if (mseResolution.kind === 'PROTECTED') {
        logMediaResolveTrace({
          tabId: tabIdEarly,
          platform: resolveSocialPlatform(pageUrlEarly ?? '') ?? 'general',
          generation:
            socialCtxEarly?.contextGeneration ?? generalCtxEarly?.pageGeneration ?? 0,
          event: 'PROVEN_UNSUPPORTED',
          candidateType: 'blob',
          rejectionReason: mseResolution.reason,
        });
        logAutomaticHandoff('MEDIA_VERIFY_UNSUPPORTED', {
          tabId: tabIdEarly,
          rejectionReason: mseResolution.reason,
          scope: 'mse',
        });
        browserMediaActionService.invalidateProtectedOffer();
        return classifyMediaResolutionOutcome({
          rejectionReason: mseResolution.reason,
          allBoundedCandidatesRejected: true,
        });
      }

      // A split-buffer player whose second file has not been requested yet: wait (briefly) instead of offering the
      // one half seen so far, and look again when the wait is over.
      if (
        mseResolution.kind === 'PENDING' &&
        mseResolution.reason === 'MSE_SPLIT_TRACKS_PENDING' &&
        isMsePlayerOnScreen(mseState, socialCtxEarly, generalCtxEarly)
      ) {
        setTimeout(() => setVerifyRevision((n) => n + 1), Math.max(250, mseResolution.retryInMs ?? 1_000));
        return classifyMediaResolutionOutcome({ verificationInFlight: true });
      }

      // The player on screen is a MediaSource fed by separate video and audio files: each file is one half, so none is
      // offered on its own — the pair is proven below and offered as one download that merges both.
      const splitTracks =
        mseResolution.kind === 'SPLIT_TRACKS' && isMsePlayerOnScreen(mseState, socialCtxEarly, generalCtxEarly)
          ? mseResolution
          : null;

      if (executableIsBlob && httpCandidates.length === 0 && !splitTracks) {
        const unresolvable = mseResolution.kind === 'UNSUPPORTED';
        const mse = getMsePlaybackContext(pageUrlEarly);
        const rejectionReason = unresolvable
          ? mseResolution.reason
          : mse.msePlaybackActive
            ? 'PLATFORM_UNOBSERVABLE'
            : 'NO_FRESH_SOURCE';
        logMediaResolveTrace({
          tabId: tabIdEarly,
          platform: resolveSocialPlatform(pageUrlEarly ?? '') ?? 'general',
          generation:
            socialCtxEarly?.contextGeneration ??
            generalCtxEarly?.pageGeneration ??
            0,
          event: unresolvable ? 'PROVEN_UNSUPPORTED' : 'TRANSIENT_UNRESOLVED',
          candidateType: 'blob',
          rejectionReason,
        });
        return classifyMediaResolutionOutcome({
          hasCandidates: false,
          rejectionReason,
          // Only proven evidence may say "can't be downloaded"; still-looking stays transient.
          allBoundedCandidatesRejected: unresolvable,
        });
      }

      const pageUrl = pageUrlEarly;
      if (!pageUrl) {
        return classifyMediaResolutionOutcome({ hasCandidates: httpCandidates.length > 0 });
      }

      const fingerprint = buildBrowserMediaFingerprint({
        pageUrl,
        mediaUrl: splitTracks
          ? (splitTracks.videoUrl ?? splitTracks.candidateUrls[0] ?? pageUrl)
          : executableIsBlob
            ? (httpCandidates[0]?.url ?? pageUrl)
            : mediaUrl,
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
        ownershipKeyHash: hashHandoffIdentity(ownershipKey),
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
      const signal = browserMediaActionService.beginVerification(nextIdentity);
      /** The result described a page state that is gone (the player moved on while this ran). */
      let staleResult = false;

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
        // Split audio/video player: prove the exact pair and offer one download that merges both files.
        if (splitTracks) {
          const engine = getV2Engine();
          if (!engine) {
            clearOrRetain();
            return classifyMediaResolutionOutcome({ rejectionReason: 'ENGINE_UNAVAILABLE' });
          }
          const probeUrl = splitTracks.videoUrl ?? splitTracks.candidateUrls[0] ?? pageUrl;
          const requestContext = await buildRequestContextFromDetectedMedia({
            mediaUrl: probeUrl,
            pageUrl,
            requiresCookies: executable.requiresCookies,
            tabId,
            navigationEpoch,
          });
          const resolved = await resolveSplitPair({
            evidence: splitTracks,
            probe: (request) => engine.probe(request),
            request: toV2RequestContext(requestContext, pageUrl),
            signal,
          });
          if (signal.aborted) {
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (
            (socialScope && !isSocialScopeCurrent(tabId, navigationEpoch, socialScope)) ||
            (generalScope && !isGeneralScopeCurrent(tabId, navigationEpoch, generalScope))
          ) {
            staleResult = true;
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (!resolved.ok) {
            const { failure } = resolved;
            staleResult = failure.outcome === 'STALE';
            clearOrRetain();
            logMediaResolveTrace({
              tabId,
              platform: socialPlatform ?? 'general',
              generation: socialScope?.socialContextGeneration ?? generalScope?.pageGeneration ?? 0,
              identityKind: nextIdentity,
              event: failure.proven ? 'PROVEN_UNSUPPORTED' : 'TRANSIENT_UNRESOLVED',
              candidateType: 'blob',
              rejectionReason: failure.reason,
            });
            return classifyMediaResolutionOutcome({
              // A temporary answer is retried like any network failure; everything else keeps its own reason.
              rejectionReason: failure.outcome === 'TRANSIENT_FAILURE' ? 'PROBE_FAILED' : failure.reason,
              hasCandidates: true,
              allBoundedCandidatesRejected: failure.proven,
            });
          }
          const pair = resolved.pair;
          const offerFp = buildBrowserMediaFingerprint({ pageUrl, mediaUrl: pair.videoUrl, platform: executable.websiteSource });
          if (
            browserMediaActionService.isFingerprintConsumed(offerFp) ||
            (nextIdentity != null && browserMediaActionService.isContentIdentityConsumed(nextIdentity))
          ) {
            if (nextIdentity != null) {
              browserMediaActionService.retainConsumedPresentation(nextIdentity);
            }
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          browserMediaActionService.handoffVerified({
            pageUrl,
            media: executable,
            analysis: splitPairAnalysis(pair, {
              title: executable.title ?? media.title ?? null,
              thumbnailUrl: executable.thumbnailUrl ?? media.thumbnailUrl ?? null,
              platform: (socialPlatform ?? 'OTHER').toUpperCase(),
            }),
            requestContext,
            mediaUrl: pair.videoUrl,
            autoShow: Boolean(pendingMediaResolutionService.get()),
            contentIdentity: nextIdentity,
            variantIdentity: `split:${hashSafeId(pair.videoUrl)}+${hashSafeId(pair.audioUrl)}`,
          });
          logMediaResolveTrace({
            tabId,
            platform: socialPlatform ?? 'general',
            generation: socialScope?.socialContextGeneration ?? generalScope?.pageGeneration ?? 0,
            identityKind: nextIdentity,
            event: 'OFFER_READY',
            outcome: 'RESOLVED_SUPPORTED',
          });
          logAutomaticHandoff('MEDIA_CTA_AVAILABLE', {
            tabId,
            contentIdentityHash: hashHandoffIdentity(nextIdentity),
          });
          return classifyMediaResolutionOutcome({ resolvedSupported: true });
        }

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
            // The ownership pass already chose the current media; its variants win the ranking.
            ownedResourceUrl: executable.finalUrl || executable.url || null,
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
            staleResult = true;
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
              scope: 'social',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (!isSocialScopeCurrent(tabId, navigationEpoch, socialScope)) {
            staleResult = true;
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(socialScope.contentIdentity),
              scope: 'social',
              reason: 'SCOPE_NOT_CURRENT',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          if (!offerResult.ok) {
            staleResult =
              offerResult.reason === 'STALE_SOCIAL_CONTEXT' ||
              offerResult.reason === 'STALE_SOURCE_GENERATION';
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
            ownedResourceUrl: executable.finalUrl || executable.url || null,
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
            staleResult = true;
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
              scope: 'general',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }
          if (!isGeneralScopeCurrent(tabId, navigationEpoch, generalScope)) {
            staleResult = true;
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
              scope: 'general',
              reason: 'SCOPE_NOT_CURRENT',
            });
            return classifyMediaResolutionOutcome({ staleToken: true });
          }

          if (!offerResult.ok) {
            staleResult =
              offerResult.reason === 'STALE_PAGE_GENERATION' ||
              offerResult.reason === 'STALE_SOURCE_GENERATION';
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
              offerResult.reason === 'LIVE_UNSUPPORTED' ||
              offerResult.reason === 'UNSUPPORTED_FORMAT' ||
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

          // The page moved on while this was verified (an item preloaded ahead is now known not to be the one shown):
          // never publish a file the current correlation rejects; look at the page again instead.
          if (
            isOfferedSourceRejectedNow({
              sourceUrl: preferred.executableUrl,
              candidates: httpCandidates.length > 0 ? httpCandidates : [media],
              tabId,
              navigationEpoch,
              pageUrl,
            })
          ) {
            staleResult = true;
            logAutomaticHandoff('MEDIA_VERIFY_STALE_RESULT_IGNORED', {
              tabId,
              contentIdentityHash: hashHandoffIdentity(generalScope.mediaIdentity),
              scope: 'general',
              reason: 'SOURCE_REJECTED_NOW',
            });
            clearOrRetain();
            return classifyMediaResolutionOutcome({ staleToken: true });
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
        // The page moved on while this ran — a trigger arrived meanwhile, a navigation or a new owner cancelled it,
        // or its result described a player state that is gone. The page reports each video only once, so waiting for
        // its next event could mean waiting forever: look at the current page again instead.
        const lookAgain = rerunRequestedRef.current || signal.aborted || staleResult;
        rerunRequestedRef.current = false;
        verifyingRef.current = false;
        browserMediaActionService.cancelVerification();
        if (lookAgain) {
          scheduleVerifyRerun(`${executable.id}|${ownershipKey}|${pageUrlEarly ?? ''}`);
        }
      }
    },
    [lastNavigation, discovery.candidates, scheduleVerifyRerun],
  );

  // Protection can be proven after an offer was already published (a player that negotiates EME, or
  // hits its first encrypted sample, mid-playback). It is checked before anything else in this effect,
  // including the "already verified this candidate" shortcut, so a standing offer is always withdrawn.
  useEffect(() => {
    if (isHome) {
      return;
    }
    const protectedTabId =
      browserMediaActionService.getActiveTabId() ??
      useBrowserStore.getState().activeTabId ??
      '__default__';
    const playback = getMsePlaybackState(protectedTabId);
    const protection = classifyMsePlayback({
      state: playback,
      hasWholeSourceCandidate: discovery.candidates.length > 0,
      hasManifestCandidate: discovery.candidates.some(isManifestCandidate),
    });
    if (protection.kind === 'PROTECTED') {
      browserMediaActionService.invalidateProtectedOffer();
      browserMediaActionService.recordVerdict(
        liveMediaIdentityOf(protectedTabId, useMediaDetectionStore.getState().lastNavigation),
        'PROTECTED',
      );
    } else if (
      protection.kind === 'SPLIT_TRACKS' &&
      // Only a published offer for one half: a verification in flight (the pair being proven) is left alone.
      browserMediaActionService.getState().status === 'verified' &&
      !isSplitOffer(browserMediaActionService.getState().analysis) &&
      isMsePlayerOnScreen(
        playback,
        socialPageContextStore.get(protectedTabId),
        generalPageMediaContextStore.get(protectedTabId),
      ) &&
      // A whole file of this same video that the player does not read (a reel's declared file, offered before its
      // player switched to split buffers) is not a half: it stays while this video is current.
      !(
        !isSplitPlayerFile(playback, browserMediaActionService.getState().mediaUrl) &&
        browserMediaActionService.getState().contentIdentity != null &&
        browserMediaActionService.getState().contentIdentity ===
          liveMediaIdentityOf(protectedTabId, useMediaDetectionStore.getState().lastNavigation)
      )
    ) {
      // A standing offer for one half of a split player (its video-only or audio-only file) is withdrawn; the pair is
      // then verified and offered as one merged download.
      browserMediaActionService.invalidateProtectedOffer('split_audio_video');
    }
  }, [discovery.ownershipKey, discovery.candidates.length, isHome, ownerRevision]);

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

    // Ownership transitions (MEDIUM → STRONG, player switch, preload becoming current) re-run
    // verification without waiting for a new network request. Its outcome — offered, or the reason it was not — is
    // recorded, so a playing video without a CTA always has an explicit account.
    const verified = discovery.media;
    const ownershipKey = discovery.ownershipKey;
    const identityAtStart = liveMediaIdentityOf(tabId, pageUrl);
    void verifyCandidate(verified, ownershipKey).then((outcome) => {
      recordVerificationOutcome({ tabId, pageUrl, media: verified, outcome });
      // A proven verdict about the video on screen stays visible while it is there (Protected / Unsupported) — only
      // for the video it was about: one the user scrolled past meanwhile never labels the next.
      if (
        outcome.kind === 'PROVEN_UNSUPPORTED' &&
        identityAtStart &&
        (browserMediaActionService.getActiveTabId() ?? useBrowserStore.getState().activeTabId ?? '__default__') ===
          tabId &&
        liveMediaIdentityOf(tabId, pageUrl) === identityAtStart
      ) {
        browserMediaActionService.recordVerdict(
          identityAtStart,
          pipelineRejectionFor(outcome.reason) === 'PROTECTED' ? 'PROTECTED' : 'UNSUPPORTED',
        );
      }
      // A temporary network/server answer is no verdict: look again shortly (bounded per media/owner/page), instead of
      // waiting for the page to happen to request the file again.
      if (outcome.kind === 'NETWORK_FAILURE') {
        setTimeout(
          () => scheduleVerifyRerun(`${verified.id}|${ownershipKey}|${pageUrl ?? ''}`),
          TRANSIENT_RETRY_MS,
        );
      }
    });
  }, [
    discovery.media,
    discovery.candidates,
    discovery.downloadable,
    discovery.ownershipKey,
    isHome,
    lastNavigation,
    scheduleVerifyRerun,
    verifyCandidate,
    verifyRevision,
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
      return {
        identity: null as string | null,
        hidden: false,
        confidence: null as 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null,
      };
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
        hidden: false,
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
      hidden: Boolean(gctx?.activeOwnerHidden),
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

  // "Already downloaded" is known before any tap: each verified offer asks the engine's duplicate lookup once (the
  // same one the tap uses — local, no network request).
  useEffect(() => {
    const fingerprint = actionState.mediaFingerprint;
    const analysis = actionState.analysis;
    if (actionState.status !== 'verified' || !analysis || !fingerprint) {
      return;
    }
    if (browserMediaActionService.isOfferDuplicate(fingerprint)) {
      return;
    }
    const tabAtAsk = browserMediaActionService.getActiveTabId();
    const selection = normalizeAnalysisToSelection(analysis);
    const option = pickOfferedQualityOption(selection.options, actionState.mediaUrl);
    if (!option) {
      return;
    }
    let cancelled = false;
    void findExistingDownload(
      {
        option,
        title: selection.title ?? '',
        pageUrl: actionState.pageUrl,
        thumbnailUrl: null,
        requestContext: actionState.requestContext,
      },
      { engine: getV2Engine(), applyEntries: () => {} },
    ).then((found) => {
      if (cancelled || !found?.duplicate || browserMediaActionService.getActiveTabId() !== tabAtAsk) {
        return;
      }
      // Already downloading is not already downloaded: follow that download instead.
      browserMediaActionService.markOfferDuplicate(
        fingerprint,
        found.duplicate === 'ALREADY_DOWNLOADED' ? 'DOWNLOADED' : 'DOWNLOADING',
        found.duplicate === 'ALREADY_DOWNLOADING' ? found.downloadId : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    actionState.analysis,
    actionState.mediaFingerprint,
    actionState.mediaUrl,
    actionState.pageUrl,
    actionState.requestContext,
    actionState.status,
  ]);

  // Moving on from a video: when the user comes back to it, a download that finished meanwhile is "Already
  // downloaded" (the "Downloaded" moment was for the video they were watching when it finished).
  const previousLiveIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLiveIdentityRef.current;
    if (previous && previous !== liveOwner.identity) {
      browserMediaActionService.markConsumedRevisitable(previous);
    }
    previousLiveIdentityRef.current = liveOwner.identity;
  }, [liveOwner.identity]);

  // Which download the action area follows for the current video: the one its tap started or found, or the one the
  // engine said was already running for the offer. Its live row status drives Downloading… / Downloaded.
  const consumedOutcome = browserMediaActionService.getConsumedOutcome(
    liveOwner.identity ?? actionState.contentIdentity,
    actionState.mediaFingerprint,
  );
  const offerDuplicate = browserMediaActionService.getOfferDuplicate(actionState.mediaFingerprint);
  const consumedRowStatus = useDownloadsStore((state) =>
    consumedOutcome?.downloadId ? (state.engineRowsById[consumedOutcome.downloadId]?.status ?? null) : null,
  );
  const offerRowStatus = useDownloadsStore((state) =>
    offerDuplicate?.downloadId ? (state.engineRowsById[offerDuplicate.downloadId]?.status ?? null) : null,
  );
  const consumedNotice = resolveConsumedDownloadNotice(consumedOutcome, consumedRowStatus);
  const offerDuplicateNotice = resolveOfferDuplicateNotice(offerDuplicate, offerRowStatus);

  // "Detecting video…": the live video (strong owner, on screen) has no offer and no final verdict, and detection is
  // working on it — it became current less than DETECTING_WINDOW_MS ago, or a not-yet-final verdict is still settling.
  const [expiredDetecting, setExpiredDetecting] = useState<{ identity: string; capped: boolean } | null>(null);
  const liveIdentity = liveOwner.identity;
  useEffect(() => {
    if (!liveIdentity) {
      return;
    }
    const windowTimer = setTimeout(
      () => setExpiredDetecting({ identity: liveIdentity, capped: false }),
      DETECTING_WINDOW_MS,
    );
    const capTimer = setTimeout(() => setExpiredDetecting({ identity: liveIdentity, capped: true }), DETECTING_MAX_MS);
    return () => {
      clearTimeout(windowTimer);
      clearTimeout(capTimer);
      setExpiredDetecting(null);
    };
  }, [liveIdentity]);
  const detectingExpiry = expiredDetecting?.identity === liveIdentity ? expiredDetecting : null;
  const liveDetecting =
    Boolean(liveIdentity) &&
    !liveOwner.hidden &&
    (!detectingExpiry ||
      browserMediaActionService.hasPendingVerdict(liveIdentity) ||
      (!detectingExpiry.capped && browserMediaActionService.isVerifying(liveIdentity)));

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
        liveVerdict: browserMediaActionService.getVerdict(liveOwner.identity),
        offerDuplicate: browserMediaActionService.isOfferDuplicate(actionState.mediaFingerprint),
        offerDuplicateNotice,
        consumedNotice,
        liveDetecting,
        liveOwnerHidden: liveOwner.hidden,
      }),
    [
      consumedNotice,
      liveDetecting,
      offerDuplicateNotice,
      liveOwner.hidden,
      serviceRevision,
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
    traceCtaPresentation({
      shown: visible,
      notice: presentation.statusNotice,
      mediaUrl: actionState.mediaUrl,
      offerIdentity: actionState.contentIdentity,
      liveIdentity: liveOwner.identity,
      liveHidden: liveOwner.hidden,
      status: actionState.status,
    });
  }, [
    actionState.status,
    actionState.contentIdentity,
    actionState.mediaUrl,
    liveOwner.hidden,
    liveOwner.identity,
    presentation.statusNotice,
    visible,
  ]);

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
    downloadId?: string | null;
    deduped?: boolean;
    duplicate?: V2DuplicateOutcome | null;
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
        // What the page's player shows, so a scroll to the next video during the tap's hand-off is seen.
        contentIdentity:
          social?.currentVisibleMediaIdentity ??
          general?.currentMediaIdentity ??
          browserMediaActionService.getState().contentIdentity ??
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

    // The player already shows another video (the next reel) than the standing offer names: never download it.
    const offerIdentity = browserMediaActionService.getState().contentIdentity;
    if (
      !isDownloadResolutionTokenCurrent(token, captureToken()) ||
      // Its player is hidden while the page moves it to another item: the offer may no longer be the video shown.
      generalPageMediaContextStore.get(token.tabId)?.activeOwnerHidden ||
      (offerIdentity != null && token.contentIdentity != null && offerIdentity !== token.contentIdentity)
    ) {
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
      const defaultOption = pickOfferedQualityOption(
        normalizeAnalysisToSelection(claim.analysis).options,
        claim.mediaUrl,
      );
      const result = await enqueueBrowserMediaDownload({
        analysis: claim.analysis,
        requestContext: claim.requestContext,
        selectedOptionId: defaultOption?.id ?? null,
        fingerprint: claim.fingerprint,
        pageUrl: claim.pageUrl,
        contentIdentity: claim.contentIdentity,
        // The offer must still be the current tab's current content when the engine accepts it.
        isOfferCurrent: () => isDownloadResolutionTokenCurrent(token, captureToken()),
      });

      recordPipelineOutcome({
        tabId: claim.tabId,
        pageUrl: claim.pageUrl,
        mediaUrl: defaultOption?.sourceUrl ?? claim.mediaUrl,
        stage: 'enqueue',
        outcome: result.ok ? (result.duplicate ? 'DUPLICATE' : 'ENQUEUED') : 'REJECTED',
        reason: result.ok ? (result.duplicate ?? (result.deduped ? 'DEDUPED' : null)) : (result.reason ?? 'ENQUEUE_FAILED'),
      });
      if (!result.ok) {
        logBrowserCta('enqueue_failed', {
          tabId: claim.tabId,
          fingerprintHash: fingerprintDiagHash(claim.fingerprint),
          handoffGeneration: claim.handoffGeneration,
          result: 'immediate_failure',
          // The hand-off's own reason code (never a URL): SOURCE_EXPIRED, PROTECTED, STALE_OFFER, ENGINE_REJECTED…
          reason: result.reason ?? null,
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
            // Carry the handoff's own reason: an expired link must not read as a network blip.
            rejectionReason: result.reason ?? 'PROBE_FAILED',
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
        result.duplicate,
      );
      logGeneralDownloadTrace('ENQUEUE_ACCEPTED', {
        tabId: claim.tabId,
      });
      if (result.downloadId && !result.duplicate) {
        options.onDownloadStarted?.(result.downloadId);
      }
      return { ok: true, downloadId: result.downloadId, deduped: result.deduped, duplicate: result.duplicate };
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

function isManifestCandidate(media: { streamType?: string | null; container?: string | null }): boolean {
  return (
    media.streamType === 'HLS' || media.streamType === 'DASH' || media.container === 'hls' || media.container === 'dash'
  );
}

/**
 * The tab's recorded MediaSource player is the one on screen now: the page's current player is a blob player and,
 * when both sides know it, the same element. Evidence about another (earlier, or background) blob player says
 * nothing about a progressive video that is playing now.
 */
/** The standing offer already downloads a split player's two files together. */
function isSplitOffer(analysis: { variants?: { audioSourceUrl?: string | null }[] } | null | undefined): boolean {
  return Boolean(analysis?.variants?.some((variant) => variant.audioSourceUrl));
}

function isMsePlayerOnScreen(
  state: { elementIdentity: string | null } | null,
  social: { activeVideoIsBlob: boolean; activeVideoElementIdentity: string | null } | null,
  general: { activeVideoIsBlob: boolean; activeMediaElementIdentity: string | null } | null,
): boolean {
  if (!state) {
    return false;
  }
  const isBlob = social ? social.activeVideoIsBlob : Boolean(general?.activeVideoIsBlob);
  const element = social ? social.activeVideoElementIdentity : (general?.activeMediaElementIdentity ?? null);
  if (!isBlob) {
    return false;
  }
  return !state.elementIdentity || !element || state.elementIdentity === element;
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
