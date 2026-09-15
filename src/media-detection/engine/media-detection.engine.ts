import { observeRequestUrl, parseMediaBridgeMessage } from '../adapters';
import {
  setNativeCandidateHandler,
  startNativeNetworkObservation,
  stopNativeNetworkObservation,
} from '../adapters/native-network.adapter';
import { DETECTION_TIMING } from '../constants';
import { describePlatformPage } from '../platform';
import {
  mediaDetectionPipeline,
  notifyBrowserDetectionSync,
  resolvePageUrl,
  isShareOrShortLink,
  logMediaDiagnostic,
  type PipelineResult,
} from '../services';
import { clearMsePlayback, markMsePlayback } from './mse-playback-context';
import { useMediaDetectionStore } from '../stores';
import type {
  BridgeActiveIframePlayerPayload,
  BridgeActiveVideoPayload,
  BridgeMediaCandidatePayload,
  BridgeMutationBatchPayload,
  BridgePageMetaPayload,
} from '../types';
import { createDebounced, isSameDocumentUrl } from '../utils';
import { logIgRuntime } from '../services/ig-runtime-diagnostics.service';
import {
  resolveSocialPlatform,
  socialPageContextStore,
  shouldClearDetectionsOnSocialBump,
} from '../social';
import type { ActiveVideoEvidence } from '../social';
import { generalPageMediaContextStore } from '../general-media';
import { extractGeneralPageVideoId } from '../general-media/general-content-identity';
import { isSameGeneralContentNavigation } from '../general-media/general-content-navigation';
import { logGeneralNetworkTrace } from '../general-media/general-media-diagnostics';

/**
 * Media Detection Engine — passive observer of browser activity.
 * Never interrupts navigation. Never downloads. Never shows UI.
 */
class MediaDetectionEngine {
  private started = false;
  private pageUrl: string | null = null;
  private navigationEpoch = 0;
  /** Owning tab for the active WebView observation stream. */
  private activeTabId: string | null = null;
  /** When false, high-frequency bridge work is deferred (app backgrounded). */
  private appActive = true;
  /** Skip identical active-video payloads before ownership work. */
  private lastActiveVideoKey = '';
  private readonly debouncedRescanNotify = createDebounced(() => {
    notifyBrowserDetectionSync();
  }, DETECTION_TIMING.rescanDebounceMs);

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    mediaDetectionPipeline.reset();
    setNativeCandidateHandler((candidate) => {
      this.observeNativeCandidate(candidate);
    });
    startNativeNetworkObservation();
  }

  stop(): void {
    this.started = false;
    this.pageUrl = null;
    this.appActive = true;
    this.activeTabId = null;
    this.lastActiveVideoKey = '';
    this.debouncedRescanNotify.cancel();
    stopNativeNetworkObservation();
    setNativeCandidateHandler(null);
    mediaDetectionPipeline.reset();
    socialPageContextStore.clearAll();
    generalPageMediaContextStore.clearAll();
  }

  /**
   * Bind observation stream to the active browser tab (Phase 4A / 5A ownership).
   */
  setActiveTab(tabId: string | null): void {
    this.activeTabId = tabId;
    socialPageContextStore.setActiveTab(tabId);
    generalPageMediaContextStore.setActiveTab(tabId);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  clearTab(tabId: string): void {
    socialPageContextStore.clearTab(tabId);
    generalPageMediaContextStore.clearTab(tabId);
  }

  /**
   * Background/foreground — preserve detections; skip mutation thrash while inactive.
   */
  setAppActive(active: boolean): void {
    this.appActive = active;
    if (active) {
      this.debouncedRescanNotify();
    } else {
      this.debouncedRescanNotify.cancel();
    }
  }

  /**
   * Called when browser navigation commits a new document URL.
   */
  onNavigationStart(url: string, epoch?: number, tabId?: string | null): void {
    if (!this.started) {
      this.start();
    }

    if (tabId) {
      this.setActiveTab(tabId);
    }

    this.navigationEpoch =
      typeof epoch === 'number' && Number.isFinite(epoch)
        ? epoch
        : this.navigationEpoch + 1;

    const store = useMediaDetectionStore.getState();

    // Query-only or trailing-slash changes on the same Reel must not wipe detections.
    if (this.pageUrl && isSameDocumentUrl(url, this.pageUrl)) {
      this.pageUrl = url;
      store.setLastNavigation(url, this.navigationEpoch);
      store.setScanning(true, Math.max(store.scanProgress, 0.3));
      this.syncSocialContext(url);
      this.syncGeneralMediaContext(url);
      return;
    }

    this.pageUrl = url;
    store.clearPageDetections();
    store.setLastNavigation(url, this.navigationEpoch);
    store.setScanning(true, 0.1);
    store.setDetectionError(null);
    mediaDetectionPipeline.reset();
    clearMsePlayback();
    this.lastActiveVideoKey = '';
    this.syncSocialContext(url);
    this.syncGeneralMediaContext(url);

    const platform = describePlatformPage(url);
    logMediaDiagnostic('input', {
      url,
      platform: platform.kind,
      isPublicContentPath: platform.isPublicContentPath,
    });

    if (isShareOrShortLink(url)) {
      const epoch = this.navigationEpoch;
      void resolvePageUrl(url).then((resolved) => {
        if (!this.isCurrentEpoch(epoch)) {
          return;
        }
        if (resolved.ok && resolved.resolvedPageUrl !== url) {
          this.pageUrl = resolved.resolvedPageUrl;
          store.setLastNavigation(resolved.resolvedPageUrl, epoch);
          this.syncSocialContext(resolved.resolvedPageUrl);
          this.syncGeneralMediaContext(resolved.resolvedPageUrl);
        }
      });
    }
  }

  onNavigationComplete(url: string): void {
    if (!this.pageUrl) {
      return;
    }
    const store = useMediaDetectionStore.getState();
    this.pageUrl = url;
    store.setLastNavigation(url, this.navigationEpoch);
    store.setScanning(true, 0.5);
  }

  onGoHome(): void {
    const store = useMediaDetectionStore.getState();
    this.pageUrl = null;
    this.navigationEpoch += 1;
    this.lastActiveVideoKey = '';
    store.clearPageDetections();
    store.setLastNavigation(null, this.navigationEpoch);
    store.setScanning(false, 0);
    mediaDetectionPipeline.reset();
    if (this.activeTabId) {
      socialPageContextStore.clearTab(this.activeTabId);
      generalPageMediaContextStore.clearTab(this.activeTabId);
    }
  }

  /**
   * Browser main-frame error — invalidate current page media CTA context.
   */
  onBrowserError(): void {
    const store = useMediaDetectionStore.getState();
    store.clearPageDetections();
    store.setScanning(false, 0);
    mediaDetectionPipeline.reset();
    clearMsePlayback();
    if (this.activeTabId) {
      socialPageContextStore.clearTab(this.activeTabId);
      generalPageMediaContextStore.clearTab(this.activeTabId);
    }
  }

  /**
   * Passive network URL observation (does not affect allow/deny).
   */
  observeUrl(url: string, pageUrl?: string): void {
    if (!this.started || !this.pageUrl) {
      return;
    }

    const effectivePage = pageUrl ?? this.pageUrl;
    if (!isSameDocumentUrl(effectivePage, this.pageUrl)) {
      return;
    }

    if (mediaDetectionPipeline.isSegmentBlocked(url)) {
      return;
    }

    const observed = observeRequestUrl(url, effectivePage);
    if (!observed) {
      // Still try MIME probe path for extensionless navigations that look media-ish.
      const epoch = this.navigationEpoch;
      void this.maybeProbeUrls([url], effectivePage, epoch);
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    const result = mediaDetectionPipeline.processNetworkUrl(
      store.detectedMedia,
      observed.url,
      observed.pageUrl,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    void this.afterIngest(result, epoch);
  }

  observeNativeCandidate(input: {
    tabId?: string;
    navigationEpoch?: number;
    observedAt?: number;
    frameUrl?: string | null;
    url: string;
    mimeType?: string | null;
    requiresCookies?: boolean;
    pageUrl?: string;
    hasRange?: boolean;
    isForMainFrame?: boolean;
    resourceFingerprint?: string | null;
    observationSource?: string | null;
  }): void {
    if (!this.started || !this.pageUrl) {
      return;
    }
    // Never attribute process-global or parked WebView traffic to the active tab.
    if (input.tabId !== this.activeTabId || input.navigationEpoch !== this.navigationEpoch) return;
    const effectivePage = input.pageUrl ?? this.pageUrl;
    const social = resolveSocialPlatform(this.pageUrl);
    const pageMatches = social
      ? isSameDocumentUrl(effectivePage, this.pageUrl)
      : isSameDocumentUrl(effectivePage, this.pageUrl) ||
        isSameGeneralContentNavigation(effectivePage, this.pageUrl);
    if (!pageMatches) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        frameClass: input.isForMainFrame === false ? 'child-frame' : 'main',
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'page_mismatch',
      });
      return;
    }
    if (mediaDetectionPipeline.isSegmentBlocked(input.url)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    const result = mediaDetectionPipeline.processNetworkUrl(
      store.detectedMedia,
      input.url,
      effectivePage,
      store.qualities,
      {
        mimeType: input.mimeType,
        detectionSource: 'native_network',
        requiresCookies: input.requiresCookies,
        hasRange: input.hasRange,
        isForMainFrame: input.isForMainFrame,
      },
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    const beforeCount = store.detectedMedia.length;
    result.media = result.media.map((media) => media.url === input.url ? {
      ...media, frameUrl: input.frameUrl ?? media.frameUrl,
      observedTabId: input.tabId,
      observedNavigationEpoch: input.navigationEpoch,
      observedPageGeneration: this.activeTabId ? generalPageMediaContextStore.get(this.activeTabId)?.pageGeneration : undefined,
    } : media);
    this.applyPipelineResult(result);
    if (result.media.length > beforeCount) {
      logIgRuntime('network_candidate', {
        hostname: safeHostname(input.url),
        source: 'native_network',
        mimeType: input.mimeType ?? null,
      });
      logGeneralNetworkTrace('CANDIDATE_INGESTED', {
        tabId: this.activeTabId,
        frameClass: input.isForMainFrame === false ? 'child-frame' : 'main',
        hasRange: Boolean(input.hasRange),
        mimeHintClass: input.mimeType ? 'present' : 'none',
        acceptedIntoIngest: true,
        candidateFingerprintHash: input.resourceFingerprint ?? null,
        observationSource: input.observationSource ?? 'webview',
      });
    } else if (result.pendingProbeUrls.length > 0) {
      logGeneralNetworkTrace('RESOURCE_CLASSIFIED', {
        tabId: this.activeTabId,
        frameClass: input.isForMainFrame === false ? 'child-frame' : 'main',
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'probe_pending',
      });
    } else if (result.rejected > 0) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        tabId: this.activeTabId,
        frameClass: input.isForMainFrame === false ? 'child-frame' : 'main',
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'parser_rejected',
      });
    }
    void this.afterIngest(result, epoch);
  }

  handleWebViewMessage(raw: string): void {
    if (!this.started || !this.pageUrl) {
      return;
    }

    const message = parseMediaBridgeMessage(raw);
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'ready':
        useMediaDetectionStore.getState().setScanning(true, 0.3);
        break;
      case 'page_meta':
        this.handlePageMeta(message.payload);
        break;
      case 'media_candidate':
        this.handleCandidate(message.payload);
        break;
      case 'mutation_batch':
        if (!this.appActive) {
          break;
        }
        this.handleBatch(message.payload);
        break;
      case 'blob_indicator':
        if (this.pageUrl) {
          markMsePlayback(this.pageUrl);
          logMediaDiagnostic('page_load', {
            pageUrl: this.pageUrl,
            mseBlob: true,
            videoPlay: true,
          });
          logIgRuntime('playback', { mseBlob: true, logger: 'shared' });
        }
        break;
      case 'active_video':
        this.handleActiveVideo(message.payload);
        break;
      case 'active_iframe_player':
        this.handleActiveIframePlayer(message.payload);
        break;
      case 'scan_complete':
        useMediaDetectionStore.getState().setScanning(false, 1);
        this.debouncedRescanNotify();
        break;
      case 'error':
        useMediaDetectionStore.getState().setDetectionError({
          code: 'detection_failure',
          message: message.payload.message || 'Detection error',
          url: this.pageUrl,
          occurredAt: Date.now(),
        });
        break;
      default:
        break;
    }
  }

  private handlePageMeta(payload: BridgePageMetaPayload): void {
    if (!this.acceptsPageUrl(payload.pageUrl)) {
      return;
    }

    // SPA route updates may arrive via page_meta before chrome sync settles.
    if (!isSameDocumentUrl(payload.pageUrl, this.pageUrl)) {
      this.pageUrl = payload.pageUrl;
      useMediaDetectionStore.getState().setLastNavigation(
        payload.pageUrl,
        this.navigationEpoch,
      );
    }
    this.syncSocialContext(payload.pageUrl);
    this.syncGeneralMediaContext(payload.pageUrl);

    const meta = mediaDetectionPipeline.processPageMeta(payload);
    if (meta) {
      useMediaDetectionStore.getState().setPageMetadata(meta);

      if (meta.ogVideo) {
        this.observeUrl(meta.ogVideo, meta.pageUrl);
      }
    }
  }

  private handleActiveVideo(payload: BridgeActiveVideoPayload): void {
    const videoKey = [
      payload.pageUrl,
      payload.elementIdentity,
      payload.currentSrc ?? '',
      payload.src ?? '',
      String(payload.paused),
      String(payload.recentlyPlayed),
      payload.associatedContentId ?? '',
      String(payload.intersectionRatio),
      String(payload.isDisplayed),
      String(payload.isVisibleStyle),
      String(payload.explicitAdMarker),
      String(payload.videoWidth), String(payload.videoHeight),
    ].join('|');
    if (videoKey === this.lastActiveVideoKey) {
      return;
    }
    this.lastActiveVideoKey = videoKey;

    if (!this.acceptsPageUrl(payload.pageUrl) && this.pageUrl) {
      // Allow same-origin SPA path drift for social + general pages.
      const sameOriginSpa = isSameOriginSpaTransition(this.pageUrl, payload.pageUrl);
      if (!sameOriginSpa && !resolveSocialPlatform(payload.pageUrl)) {
        return;
      }
    }
    if (!this.activeTabId) {
      return;
    }
    if (!this.pageUrl || !isSameDocumentUrl(payload.pageUrl, this.pageUrl)) {
      // SPA content transition without full document reload.
      const social = resolveSocialPlatform(payload.pageUrl);
      const sameOriginSpa =
        this.pageUrl != null &&
        isSameOriginSpaTransition(this.pageUrl, payload.pageUrl);

      if (social || sameOriginSpa) {
        const prevSocial = social
          ? socialPageContextStore.get(this.activeTabId)
          : null;
        const prevGeneral = !social
          ? generalPageMediaContextStore.get(this.activeTabId)
          : null;

        this.pageUrl = payload.pageUrl;
        useMediaDetectionStore.getState().setLastNavigation(
          payload.pageUrl,
          this.navigationEpoch,
        );
        this.syncSocialContext(payload.pageUrl);
        this.syncGeneralMediaContext(payload.pageUrl);

        if (social) {
          const nextIdentity = socialPageContextStore.get(this.activeTabId);
          if (
            prevSocial &&
            nextIdentity &&
            prevSocial.canonicalContentId &&
            nextIdentity.canonicalContentId &&
            prevSocial.canonicalContentId !== nextIdentity.canonicalContentId
          ) {
            useMediaDetectionStore.getState().clearPageDetections();
            mediaDetectionPipeline.reset();
          }
        } else if (prevGeneral) {
          const nextGeneral = generalPageMediaContextStore.get(this.activeTabId);
          if (
            nextGeneral &&
            nextGeneral.pageGeneration !== prevGeneral.pageGeneration
          ) {
            // Meaningful SPA path change — drop prior page detections.
            useMediaDetectionStore.getState().clearPageDetections();
            mediaDetectionPipeline.reset();
          }
        }
      } else if (!this.acceptsPageUrl(payload.pageUrl)) {
        return;
      }
    }

    const evidence: ActiveVideoEvidence = {
      pageUrl: payload.pageUrl,
      elementIdentity: payload.elementIdentity,
      currentSrc: payload.currentSrc,
      src: payload.src,
      isBlob: payload.isBlob,
      paused: payload.paused,
      ended: payload.ended,
      readyState: payload.readyState,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
      muted: payload.muted,
      currentTimeBucket: payload.currentTimeBucket,
      intersectionRatio: payload.intersectionRatio,
      viewportCenterDistance: payload.viewportCenterDistance,
      isDisplayed: payload.isDisplayed,
      isVisibleStyle: payload.isVisibleStyle,
      recentlyPlayed: payload.recentlyPlayed,
      explicitAdMarker: payload.explicitAdMarker,
      associatedContentId: payload.associatedContentId,
      observedAt: Date.now(),
    };

    if (payload.isBlob && this.pageUrl) {
      markMsePlayback(this.pageUrl);
    }

    if (resolveSocialPlatform(payload.pageUrl)) {
      const beforeGen =
        socialPageContextStore.get(this.activeTabId)?.contextGeneration ?? 0;
      const beforeIdentity =
        socialPageContextStore.get(this.activeTabId)?.currentVisibleMediaIdentity ??
        null;
      socialPageContextStore.applyActiveVideoEvidence({
        tabId: this.activeTabId,
        navigationEpoch: this.navigationEpoch,
        evidence,
      });
      const after = socialPageContextStore.get(this.activeTabId);
      const afterGen = after?.contextGeneration ?? 0;
      const afterIdentity = after?.currentVisibleMediaIdentity ?? null;
      const beforeWasCanonical = Boolean(
        beforeIdentity && !beforeIdentity.includes(':ephemeral:'),
      );
      const ownershipChanged =
        afterGen > beforeGen ||
        Boolean(beforeIdentity && afterIdentity && beforeIdentity !== afterIdentity);
      const bumpKind =
        !ownershipChanged
          ? 'none'
          : !beforeWasCanonical && Boolean(after?.canonicalContentId)
            ? 'identity_upgrade'
            : 'ownership_change';
      if (shouldClearDetectionsOnSocialBump({ bumpKind })) {
        useMediaDetectionStore.getState().clearPageDetections();
        mediaDetectionPipeline.reset();
      }
    } else {
      // Ensure general context exists before applying evidence (first observation).
      if (!generalPageMediaContextStore.get(this.activeTabId) && this.pageUrl) {
        generalPageMediaContextStore.syncFromPageUrl({
          tabId: this.activeTabId,
          pageUrl: this.pageUrl,
          navigationEpoch: this.navigationEpoch,
        });
      }
      generalPageMediaContextStore.applyActiveVideoEvidence({
        tabId: this.activeTabId,
        navigationEpoch: this.navigationEpoch,
        evidence,
      });
    }
    this.debouncedRescanNotify();
  }

  private handleActiveIframePlayer(payload: BridgeActiveIframePlayerPayload): void {
    if (!this.activeTabId || !this.pageUrl) {
      return;
    }
    if (resolveSocialPlatform(this.pageUrl) || resolveSocialPlatform(payload.pageUrl)) {
      return;
    }
    if (!this.acceptsPageUrl(payload.pageUrl)) {
      const sameOriginSpa = isSameOriginSpaTransition(this.pageUrl, payload.pageUrl);
      if (!sameOriginSpa) {
        return;
      }
      this.pageUrl = payload.pageUrl;
      useMediaDetectionStore.getState().setLastNavigation(
        payload.pageUrl,
        this.navigationEpoch,
      );
      this.syncGeneralMediaContext(payload.pageUrl);
    }

    if (!generalPageMediaContextStore.get(this.activeTabId)) {
      generalPageMediaContextStore.syncFromPageUrl({
        tabId: this.activeTabId,
        pageUrl: this.pageUrl,
        navigationEpoch: this.navigationEpoch,
      });
    }

    const associated =
      payload.associatedContentId ??
      extractGeneralPageVideoId(payload.pageUrl) ??
      extractGeneralPageVideoId(this.pageUrl);

    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: this.activeTabId,
      navigationEpoch: this.navigationEpoch,
      evidence: {
        pageUrl: payload.pageUrl || this.pageUrl,
        iframeIdentity: payload.iframeIdentity,
        iframeSrc: payload.iframeSrc,
        frameClass: payload.frameClass,
        isDisplayed: payload.isDisplayed,
        isVisibleStyle: payload.isVisibleStyle,
        intersectionRatio: payload.intersectionRatio,
        width: payload.width,
        height: payload.height,
        allowFullscreen: payload.allowFullscreen,
        allow: payload.allow,
        looksPlayer: payload.looksPlayer,
        sameOriginVideoCount: payload.sameOriginVideoCount,
        associatedContentId: associated,
        observedAt: Date.now(),
      },
    });
    this.debouncedRescanNotify();
  }

  private syncSocialContext(pageUrl: string): void {
    if (!this.activeTabId) {
      return;
    }
    if (!resolveSocialPlatform(pageUrl)) {
      socialPageContextStore.clearTab(this.activeTabId);
      return;
    }
    socialPageContextStore.syncFromPageUrl({
      tabId: this.activeTabId,
      pageUrl,
      navigationEpoch: this.navigationEpoch,
    });
  }

  private syncGeneralMediaContext(pageUrl: string): void {
    if (!this.activeTabId) {
      return;
    }
    if (resolveSocialPlatform(pageUrl)) {
      generalPageMediaContextStore.clearTab(this.activeTabId);
      return;
    }
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: this.activeTabId,
      pageUrl,
      navigationEpoch: this.navigationEpoch,
    });
  }

  private handleCandidate(payload: BridgeMediaCandidatePayload): void {
    if (!this.acceptsPageUrl(payload.pageUrl)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    const result = mediaDetectionPipeline.processBridgeCandidate(
      store.detectedMedia,
      payload,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    void this.afterIngest(result, epoch);
  }

  private handleBatch(payload: BridgeMutationBatchPayload): void {
    if (!this.acceptsPageUrl(payload.pageUrl)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    if (store.scanProgress < 1) {
      store.setScanning(true, Math.max(store.scanProgress, 0.7));
    }
    const result = mediaDetectionPipeline.processBridgeBatch(
      store.detectedMedia,
      payload,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    store.setScanning(false, 1);
    void this.afterIngest(result, epoch);
    this.debouncedRescanNotify();
  }

  private applyPipelineResult(result: PipelineResult): void {
    if (!this.pageUrl) {
      return;
    }

    const store = useMediaDetectionStore.getState();
    if (result.media !== store.detectedMedia) {
      result.media = result.media.map((media) => media.observedTabId ? media : {
        ...media,
        observedTabId: this.activeTabId,
        observedNavigationEpoch: this.navigationEpoch,
        observedPageGeneration: this.activeTabId ? generalPageMediaContextStore.get(this.activeTabId)?.pageGeneration : undefined,
      });
    }
    const previousCount = store.detectedMedia.length;

    if (result.media !== store.detectedMedia) {
      useMediaDetectionStore.setState({
        detectedMedia: result.media,
        videoFormats: result.media.filter((m) => m.category === 'video'),
        audioFormats: result.media.filter((m) => m.category === 'audio'),
        streamFormats: result.media.filter((m) => m.category === 'stream'),
        confidence:
          result.media.length === 0
            ? 0
            : Number(
                (
                  result.media.reduce((s, m) => s + m.confidence, 0) /
                  result.media.length
                ).toFixed(3),
              ),
        lastScan: Date.now(),
        statistics: {
          ...store.statistics,
          totalDetected: result.media.length,
          videoCount: result.media.filter((m) => m.category === 'video').length,
          audioCount: result.media.filter((m) => m.category === 'audio').length,
          streamCount: result.media.filter((m) => m.category === 'stream').length,
          duplicateUpdates:
            store.statistics.duplicateUpdates + result.updated,
          rejectedCount: store.statistics.rejectedCount + result.rejected,
          lastScanDurationMs: result.durationMs,
          scansCompleted: store.statistics.scansCompleted + 1,
        },
      });
      if (result.media.length > previousCount) {
        const newest = result.media[result.media.length - 1];
        logIgRuntime('store_insert', {
          count: result.media.length,
          hostname: safeHostname(newest?.url ?? ''),
          mimeType: newest?.mimeType ?? null,
          confidence: newest?.confidence ?? null,
        });
      }
    } else if (result.rejected > 0) {
      store.bumpStatistics({
        rejectedCount: store.statistics.rejectedCount + result.rejected,
        lastScanDurationMs: result.durationMs,
      });
    }

    if (result.qualities.length) {
      store.upsertQualities(result.qualities);
    }
  }

  private async afterIngest(
    result: PipelineResult,
    epoch: number,
  ): Promise<void> {
    await this.maybeProbeUrls(result.pendingProbeUrls, this.pageUrl, epoch);
    await this.maybeEnrichManifests(result, epoch);
  }

  private async maybeProbeUrls(
    urls: string[],
    pageUrl: string | null,
    epoch: number,
  ): Promise<void> {
    if (!pageUrl || !urls.length) {
      return;
    }
    const unique = Array.from(new Set(urls)).slice(0, 8);
    for (const url of unique) {
      try {
        if (
          !this.isCurrentEpoch(epoch) ||
          mediaDetectionPipeline.signal?.aborted
        ) {
          return;
        }
        const store = useMediaDetectionStore.getState();
        const probed = await mediaDetectionPipeline.enrichWithMimeProbe(
          url,
          pageUrl,
          store.detectedMedia,
          store.qualities,
        );
        if (!probed || !this.isCurrentEpoch(epoch)) {
          continue;
        }
        this.applyPipelineResult(probed);
        await this.maybeEnrichManifests(probed, epoch);
      } catch {
        // Isolation
      }
    }
  }

  private async maybeEnrichManifests(
    result: PipelineResult,
    epoch: number,
  ): Promise<void> {
    const pageAtStart = this.pageUrl;
    if (!pageAtStart) {
      return;
    }

    const streams = result.media.filter((m) => {
      const kind = mediaDetectionPipeline.needsManifestEnrichment(m);
      return kind != null;
    });

    for (const stream of streams.slice(0, 3)) {
      try {
        const kind = mediaDetectionPipeline.needsManifestEnrichment(stream);
        const enriched =
          kind === 'dash'
            ? await mediaDetectionPipeline.enrichDashMedia(stream)
            : await mediaDetectionPipeline.enrichHlsMedia(stream);
        if (!enriched) {
          continue;
        }
        if (
          !this.isCurrentEpoch(epoch) ||
          !this.pageUrl ||
          !isSameDocumentUrl(pageAtStart, this.pageUrl) ||
          mediaDetectionPipeline.signal?.aborted
        ) {
          return;
        }
        if (!isSameDocumentUrl(enriched.media.pageUrl, this.pageUrl)) {
          continue;
        }

        useMediaDetectionStore.getState().upsertMedia(enriched.media);
        if (enriched.qualities.length) {
          useMediaDetectionStore.getState().upsertQualities(enriched.qualities);
        }
        if (enriched.media.isDrm) {
          useMediaDetectionStore.getState().setDetectionError({
            code: 'encrypted_hls',
            message:
              enriched.media.streamType === 'DASH'
                ? 'Encrypted DASH stream detected — download not supported.'
                : 'Encrypted HLS stream detected — download not supported.',
            url: enriched.media.url,
            occurredAt: Date.now(),
          });
        }
      } catch {
        // Isolation — enrichment failures must never crash browsing.
      }
    }
  }

  private acceptsPageUrl(pageUrl: string | null | undefined): boolean {
    if (!this.pageUrl || !pageUrl) {
      return false;
    }
    return isSameDocumentUrl(pageUrl, this.pageUrl);
  }

  private isCurrentEpoch(epoch: number): boolean {
    return epoch === this.navigationEpoch;
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Same-origin SPA route change (path/query) without requiring social hosts. */
function isSameOriginSpaTransition(fromUrl: string, toUrl: string): boolean {
  try {
    const a = new URL(fromUrl);
    const b = new URL(toUrl);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

export const mediaDetectionEngine = new MediaDetectionEngine();
