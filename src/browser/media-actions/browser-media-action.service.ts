import type {
  BrowserMediaActionState,
  BrowserMediaActionStatus,
  BrowserMediaHandoffClaim,
  BrowserMediaQualityFreeze,
  BrowserMediaSelectionClaim,
  BrowserMediaVerifiedHandoff,
} from './browser-media-action.types';
import { initialBrowserMediaActionState } from './browser-media-action.types';
import {
  fingerprintDiagHash,
  logBrowserCta,
} from './browser-cta-diagnostics';
import { isSameContentIdentity, shouldInvalidateCurrentMedia } from './cta-persistence';
import { buildBrowserMediaFingerprint } from './media-fingerprint';
import { isSameDocumentUrl } from '@/media-detection/utils';
import { traceOfferState } from '@/media-detection/pipeline/pipeline-outcome';
import { stripRequestContextSecrets } from '@/media-detection/session-media/strip-secrets';
import type { MediaRequestContext } from '@/downloads/types/request-context';

type Listener = () => void;

function sanitizeHandoffRequestContext(
  context: MediaRequestContext | null | undefined,
): MediaRequestContext | null {
  const stripped = stripRequestContextSecrets(context);
  if (!stripped || !context) {
    return stripped;
  }
  const sessionBound = Boolean(
    context.cookiesRequired ||
      context.hasCookies ||
      context.authMode === 'SESSION_COOKIE' ||
      context.authMode === 'SESSION_PLUS_REFERER' ||
      context.headers?.Cookie,
  );
  return {
    ...stripped,
    cookiesRequired: Boolean(context.cookiesRequired || sessionBound),
    authMode:
      context.authMode ??
      (sessionBound ? 'SESSION_COOKIE' : stripped.authMode ?? 'PUBLIC'),
  };
}

type ActiveHandoff = {
  generation: number;
  fingerprint: string;
  tabId: string;
  pageUrl: string | null;
};

type TabMediaSlice = {
  state: BrowserMediaActionState;
  verifiedCandidateId: string | null;
  verificationAbort: AbortController | null;
  /** Content identity the in-flight verification belongs to (null when unscoped or idle). */
  verificationContentIdentity: string | null;
  /**
   * Consumed media fingerprints for this tab's current navigation window.
   * Cleared on navigation (bounded). Identity is media fingerprint
   * (platform|pageKey|mediaKey) — not raw signed URL.
   */
  consumedFingerprints: Set<string>;
  /** Which consumption each download recorded, so a download that fails for want of a fresh link can give it back. */
  consumedDownloads: Map<string, { fingerprint: string; contentIdentity: string | null }>;
  handoffGeneration: number;
  /** In-flight handoffs keyed by generation — supports nav during enqueue. */
  pendingHandoffs: Map<number, ActiveHandoff>;
  selectionGeneration: number;
  /** Frozen identities at quality-sheet lock — stale SPA/nav must no-op confirm. */
  qualityFreeze: import('./browser-media-action.types').BrowserMediaQualityFreeze | null;
  /**
   * The page this tab's offer belonged to when the tab was last brought to the front. The navigation reported right
   * after a tab switch names the page the tab already shows — not a navigation inside the tab.
   */
  activationPageUrl: string | null;
  /**
   * What verification proved about the videos this tab's page showed (by content identity): a protected or
   * unsupported one keeps saying so while it is on screen instead of an empty action area. Bounded, per navigation.
   */
  verdicts: Map<string, { verdict: BrowserMediaCurrentVerdict; since: number }>;
  /**
   * Offers (by media fingerprint) the user already had before tapping: in the library / as a gallery copy
   * (DOWNLOADED), or a download already under way (DOWNLOADING, with its id so its completion can be followed).
   */
  duplicateOffers: Map<string, BrowserOfferDuplicate>;
  /**
   * What each consumption (keyed like `consumedFingerprints`) resulted in: the download it started or found, and
   * whether the video was already in the library BEFORE this tap. A consumption is not "already downloaded" by
   * itself — a download this tap just started is "Downloading…", then "Downloaded".
   */
  consumedOutcomes: Map<string, BrowserConsumedOutcome>;
  /** The outcome of the consumption the tab's `consumed` state shows (its fingerprint is cleared with the offer). */
  lastConsumedOutcome: BrowserConsumedOutcome | null;
};

export type BrowserOfferDuplicate = { kind: 'DOWNLOADED' | 'DOWNLOADING'; downloadId: string | null };

export type BrowserConsumedOutcome = {
  downloadId: string | null;
  /** The video was already downloaded before this attempt (the engine answered ALREADY_DOWNLOADED). */
  preExisting: boolean;
  /** The user moved on to another video and came back: a completed download now reads "Already downloaded". */
  revisited: boolean;
};

export type BrowserConsumedDuplicate = 'ALREADY_DOWNLOADED' | 'ALREADY_DOWNLOADING' | null | undefined;

export type BrowserMediaCurrentVerdict = 'PROTECTED' | 'UNSUPPORTED';

/**
 * How long a negative verdict must stand — no offer, no new verification of the same video — before it is shown. One
 * candidate refused (a subtitle or audio playlist, an ad's manifest, the first of several files) is not the video's
 * answer: the source that downloads may arrive a moment later, and a "can't be downloaded" it then replaces is a false
 * statement the user saw. Until then the action area shows nothing.
 */
export const NEGATIVE_VERDICT_SETTLE_MS = 8_000;

const MAX_VERDICTS_PER_TAB = 32;

const slices = new Map<string, TabMediaSlice>();
const listeners = new Set<Listener>();
/** Default slice for boot/tests — production always calls setActiveTab. */
let activeTabId: string | null = '__default__';

/** Soft bound: prune oldest when exceeded within a navigation window. */
const MAX_CONSUMED_PER_TAB = 64;

function emptySlice(): TabMediaSlice {
  return {
    state: { ...initialBrowserMediaActionState },
    verifiedCandidateId: null,
    verificationAbort: null,
    verificationContentIdentity: null,
    consumedFingerprints: new Set(),
    consumedDownloads: new Map(),
    handoffGeneration: 0,
    pendingHandoffs: new Map(),
    selectionGeneration: 0,
    qualityFreeze: null,
    activationPageUrl: null,
    verdicts: new Map(),
    duplicateOffers: new Map(),
    consumedOutcomes: new Map(),
    lastConsumedOutcome: null,
  };
}

function ensureSlice(tabId: string): TabMediaSlice {
  let slice = slices.get(tabId);
  if (!slice) {
    slice = emptySlice();
    slices.set(tabId, slice);
  }
  return slice;
}

function emit(): void {
  const active = slices.get(activeTabId ?? '__default__');
  if (active) {
    traceOfferState({ tabId: activeTabId, status: active.state.status, mediaUrl: active.state.mediaUrl });
  }
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

function requireActiveSlice(): TabMediaSlice {
  const id = activeTabId ?? '__default__';
  if (!activeTabId) {
    activeTabId = id;
  }
  return ensureSlice(id);
}

function patchActive(partial: Partial<BrowserMediaActionState>): BrowserMediaActionState {
  const slice = requireActiveSlice();
  slice.state = { ...slice.state, ...partial };
  emit();
  return slice.state;
}

function clearExecutableOfferFields(): Partial<BrowserMediaActionState> {
  return {
    media: null,
    analysis: null,
    requestContext: null,
    mediaUrl: null,
    mediaFingerprint: null,
    variantIdentity: null,
    errorMessage: null,
    downloadId: null,
    downloadProgress: null,
    dismissed: false,
    autoShownOnce: false,
    selectionLocked: false,
  };
}

function clearOfferFields(): Partial<BrowserMediaActionState> {
  return {
    ...clearExecutableOfferFields(),
    contentIdentity: null,
  };
}

function buildContentConsumptionKey(tabId: string, contentIdentity: string): string {
  return `content:${tabId}:${contentIdentity}`;
}

function addConsumed(
  slice: TabMediaSlice,
  fingerprint: string,
  tabId: string,
  contentIdentity?: string | null,
): void {
  slice.consumedFingerprints.add(fingerprint);
  slice.consumedFingerprints.add(buildTabScopedConsumptionKey(tabId, fingerprint));
  if (contentIdentity) {
    slice.consumedFingerprints.add(buildContentConsumptionKey(tabId, contentIdentity));
  }
  if (slice.consumedFingerprints.size > MAX_CONSUMED_PER_TAB * 2) {
    const entries = [...slice.consumedFingerprints];
    const drop = entries.length - MAX_CONSUMED_PER_TAB;
    for (let i = 0; i < drop; i += 1) {
      slice.consumedFingerprints.delete(entries[i]!);
    }
  }
}

function rememberConsumedOutcome(
  slice: TabMediaSlice,
  tabId: string,
  fingerprint: string,
  contentIdentity: string | null | undefined,
  downloadId: string | null | undefined,
  duplicate: BrowserConsumedDuplicate,
): void {
  const outcome: BrowserConsumedOutcome = {
    downloadId: downloadId ?? null,
    preExisting: duplicate === 'ALREADY_DOWNLOADED',
    revisited: false,
  };
  slice.lastConsumedOutcome = outcome;
  slice.consumedOutcomes.set(buildTabScopedConsumptionKey(tabId, fingerprint), outcome);
  if (contentIdentity) {
    slice.consumedOutcomes.set(buildContentConsumptionKey(tabId, contentIdentity), outcome);
  }
  while (slice.consumedOutcomes.size > MAX_CONSUMED_PER_TAB * 2) {
    const oldest = slice.consumedOutcomes.keys().next().value;
    if (oldest === undefined) break;
    slice.consumedOutcomes.delete(oldest);
  }
}

function rememberConsumedDownload(
  slice: TabMediaSlice,
  downloadId: string | null | undefined,
  fingerprint: string,
  contentIdentity: string | null | undefined,
): void {
  if (!downloadId) {
    return;
  }
  slice.consumedDownloads.set(downloadId, { fingerprint, contentIdentity: contentIdentity ?? null });
  if (slice.consumedDownloads.size > MAX_CONSUMED_PER_TAB) {
    const oldest = slice.consumedDownloads.keys().next().value;
    if (oldest !== undefined) {
      slice.consumedDownloads.delete(oldest);
    }
  }
}

function isConsumedInSlice(
  slice: TabMediaSlice,
  tabId: string,
  fingerprint: string,
  contentIdentity?: string | null,
): boolean {
  if (
    slice.consumedFingerprints.has(fingerprint) ||
    slice.consumedFingerprints.has(buildTabScopedConsumptionKey(tabId, fingerprint))
  ) {
    return true;
  }
  if (
    contentIdentity &&
    slice.consumedFingerprints.has(buildContentConsumptionKey(tabId, contentIdentity))
  ) {
    return true;
  }
  return false;
}

function findPendingForFingerprint(
  slice: TabMediaSlice,
  fingerprint: string,
): ActiveHandoff | null {
  for (const handoff of slice.pendingHandoffs.values()) {
    if (handoff.fingerprint === fingerprint) {
      return handoff;
    }
  }
  return null;
}

function firstPending(slice: TabMediaSlice): ActiveHandoff | null {
  for (const handoff of slice.pendingHandoffs.values()) {
    return handoff;
  }
  return null;
}

function toStatusLabel(status: BrowserMediaActionStatus): string {
  switch (status) {
    case 'verified':
    case 'failed':
      return 'AVAILABLE';
    case 'preparing':
      return 'HANDOFF_IN_PROGRESS';
    case 'consumed':
    case 'downloading':
    case 'completed':
      return 'CONSUMED';
    default:
      return 'NONE';
  }
}

/** Canonical CTA consumption identity key: tabId + mediaFingerprint */
export function buildTabScopedConsumptionKey(
  tabId: string,
  mediaFingerprint: string,
): string {
  return `${tabId}:${mediaFingerprint}`;
}

/**
 * Phase 3F ownership:
 * - Browser CTA: NONE → AVAILABLE → HANDOFF_IN_PROGRESS → CONSUMED
 * - Successful Phase 1 enqueue is the consume boundary (not COMPLETED).
 * - Later FAILED/CANCELLED/PAUSED/WAITING_FOR_WIFI do not resurrect CTA.
 * - Consumption is ephemeral per browser session / navigation window (not persisted).
 */
export const browserMediaActionService = {
  setActiveTab(tabId: string): void {
    const switched = activeTabId !== tabId;
    activeTabId = tabId;
    const slice = ensureSlice(tabId);
    if (switched) {
      slice.activationPageUrl = slice.state.pageUrl;
    }
    emit();
  },

  getActiveTabId(): string | null {
    return activeTabId;
  },

  clearTab(tabId: string): void {
    const slice = slices.get(tabId);
    if (slice) {
      slice.verificationAbort?.abort();
      const pending = firstPending(slice);
      logBrowserCta('tab_closed_cleanup', {
        tabId,
        handoffGeneration: pending?.generation ?? null,
        fingerprintHash: fingerprintDiagHash(pending?.fingerprint),
      });
    }
    slices.delete(tabId);
    if (activeTabId === tabId) {
      emit();
    }
  },

  /** Eviction: keep consumed keys + in-flight handoff identity, drop live offer UI. */
  suspendTab(tabId: string): void {
    const slice = slices.get(tabId);
    if (!slice) {
      return;
    }
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verifiedCandidateId = null;
    const keepConsumed =
      slice.state.status === 'consumed' || slice.pendingHandoffs.size > 0;
    slice.state = {
      ...initialBrowserMediaActionState,
      pageUrl: slice.state.pageUrl,
      status: keepConsumed && slice.state.status === 'consumed' ? 'consumed' : 'idle',
      selectionLocked: false,
    };
    if (activeTabId === tabId) {
      emit();
    }
  },

  getState(): BrowserMediaActionState {
    return requireActiveSlice().state;
  },

  getVerifiedCandidateId(): string | null {
    return requireActiveSlice().verifiedCandidateId;
  },

  isFingerprintConsumed(fingerprint: string | null | undefined): boolean {
    if (!fingerprint) {
      return false;
    }
    const slice = requireActiveSlice();
    const tabKey = activeTabId ?? '__default__';
    return isConsumedInSlice(slice, tabKey, fingerprint);
  },

  isContentIdentityConsumed(contentIdentity: string | null | undefined): boolean {
    if (!contentIdentity) {
      return false;
    }
    const slice = requireActiveSlice();
    const tabKey = activeTabId ?? '__default__';
    return isConsumedInSlice(slice, tabKey, '', contentIdentity);
  },

  /**
   * Same-content rediscovery after enqueue — keep CONSUMED, never idle/TRACKING.
   */
  retainConsumedPresentation(contentIdentity: string | null | undefined): void {
    if (!contentIdentity || !this.isContentIdentityConsumed(contentIdentity)) {
      return;
    }
    const slice = requireActiveSlice();
    if (slice.state.status === 'preparing' || slice.state.selectionLocked) {
      return;
    }
    logBrowserCta('rediscovery_suppressed', {
      tabId: activeTabId,
      state: 'CONSUMED',
      result: 'retain_consumed',
    });
    if (slice.state.status !== 'consumed' || slice.state.contentIdentity !== contentIdentity) {
      patchActive({
        status: 'consumed',
        ...clearExecutableOfferFields(),
        contentIdentity,
      });
    }
  },

  isSelectionLocked(): boolean {
    return requireActiveSlice().state.selectionLocked;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  resetForNavigation(pageUrl: string | null): void {
    const slice = requireActiveSlice();
    const tabKey = activeTabId ?? '__default__';
    const activationPageUrl = slice.activationPageUrl;
    slice.activationPageUrl = null;
    if (isSameDocumentUrl(activationPageUrl, pageUrl)) {
      // Back on a tab: its page, its offer and what it already downloaded are all still there.
      logBrowserCta('navigation_invalidated', { tabId: tabKey, pageUrl, result: 'tab_switch_kept' });
      return;
    }
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verifiedCandidateId = null;
    slice.qualityFreeze = null;
    // Bound memory: prune consumed set on navigation. In-flight handoffs may still
    // commit their fingerprint later without mutating a different media offer.
    slice.consumedFingerprints.clear();
    slice.consumedDownloads.clear();
    slice.consumedOutcomes.clear();
    slice.lastConsumedOutcome = null;
    slice.verdicts.clear();
    slice.duplicateOffers.clear();
    const pending = firstPending(slice);
    slice.state = {
      ...initialBrowserMediaActionState,
      pageUrl,
      status: 'idle',
      selectionLocked: false,
    };
    logBrowserCta('navigation_invalidated', {
      tabId: tabKey,
      pageUrl,
      handoffGeneration: pending?.generation ?? null,
      fingerprintHash: fingerprintDiagHash(pending?.fingerprint),
    });
    emit();
  },

  /**
   * Phase 4 feed swipe: current social content changed while page document may be same.
   * Clears the live offer so Video B can verify — does NOT clear consumed keys
   * (same Media A + CDN refresh must stay CONSUMED).
   *
   * Requires a strong/medium next owner — WEAK/transient identity noise must not
   * wipe sticky AVAILABLE (CDN path churn / intersection dips).
   */
  invalidateStaleSocialOffer(
    nextContentIdentity: string | null,
    nextOwnershipConfidence:
      | 'STRONG'
      | 'MEDIUM'
      | 'WEAK'
      | 'REJECTED'
      | null = 'STRONG',
  ): boolean {
    const slice = requireActiveSlice();
    if (slice.state.selectionLocked || slice.state.status === 'preparing') {
      return false;
    }
    if (!nextContentIdentity) {
      return false;
    }
    const prior = slice.state.contentIdentity;
    if (
      !shouldInvalidateCurrentMedia({
        priorContentIdentity: prior,
        nextContentIdentity,
        nextOwnershipConfidence,
        handoffOrSelectionLocked: slice.state.selectionLocked,
      })
    ) {
      return false;
    }
    // No live offer / already idle — nothing to invalidate.
    if (
      slice.state.status === 'idle' &&
      !slice.verifiedCandidateId &&
      !slice.state.mediaFingerprint
    ) {
      return false;
    }
    // First verification for this very content still running (no offer yet): candidate enrichment or an
    // ownership upgrade must not abort it — only verification of different content is stale.
    if (
      !prior &&
      slice.verificationAbort &&
      isSameContentIdentity(slice.verificationContentIdentity, nextContentIdentity)
    ) {
      return false;
    }
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verifiedCandidateId = null;
    slice.qualityFreeze = null;
    const tabKey = activeTabId ?? '__default__';
    const priorFp = slice.state.mediaFingerprint;
    slice.state = {
      ...slice.state,
      status: 'idle',
      ...clearOfferFields(),
      contentIdentity: null,
      variantIdentity: null,
      errorMessage: null,
      selectionLocked: false,
      dismissed: false,
    };
    logBrowserCta('navigation_invalidated', {
      tabId: tabKey,
      result: 'social_content_changed',
      fingerprintHash: fingerprintDiagHash(priorFp ?? prior),
    });
    emit();
    return true;
  },

  /**
   * Encrypted playback was proven for the player on screen. Any offer standing for it must go away —
   * a protected stream is never downloadable, whatever was published before the evidence arrived.
   * A handoff already in flight is left alone; the enqueue path has its own staleness checks.
   */
  /** Withdraws a standing offer the current player has proven cannot be downloaded (protected, or split A/V). */
  invalidateProtectedOffer(reason: 'protected_playback' | 'split_audio_video' = 'protected_playback'): boolean {
    const slice = requireActiveSlice();
    if (slice.state.selectionLocked || slice.state.status === 'preparing') {
      return false;
    }
    if (
      slice.state.status === 'idle' &&
      !slice.verifiedCandidateId &&
      !slice.state.mediaFingerprint
    ) {
      return false;
    }
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verifiedCandidateId = null;
    slice.qualityFreeze = null;
    const priorFp = slice.state.mediaFingerprint;
    slice.state = {
      ...slice.state,
      status: 'idle',
      ...clearOfferFields(),
      contentIdentity: null,
      variantIdentity: null,
      errorMessage: null,
      selectionLocked: false,
      dismissed: false,
    };
    logBrowserCta('navigation_invalidated', {
      tabId: activeTabId ?? '__default__',
      result: reason,
      fingerprintHash: fingerprintDiagHash(priorFp),
    });
    emit();
    return true;
  },

  setDetecting(pageUrl: string | null): void {
    const slice = requireActiveSlice();
    if (
      slice.verifiedCandidateId ||
      slice.state.status === 'preparing' ||
      slice.state.status === 'consumed' ||
      slice.state.selectionLocked
    ) {
      return;
    }
    patchActive({
      status: 'detecting',
      pageUrl,
      errorMessage: null,
    });
  },

  setVerified(handoff: BrowserMediaVerifiedHandoff): void {
    const slice = requireActiveSlice();
    const tabKey = activeTabId ?? '__default__';

    const fingerprint = buildBrowserMediaFingerprint({
      pageUrl: handoff.pageUrl,
      mediaUrl: handoff.mediaUrl,
      platform: handoff.analysis.platform,
    });

    // Same-media rediscovery while that media's handoff is in progress — keep lock.
    if (findPendingForFingerprint(slice, fingerprint) || slice.state.status === 'preparing') {
      if (
        slice.state.status === 'preparing' &&
        slice.state.mediaFingerprint === fingerprint
      ) {
        logBrowserCta('rediscovery_suppressed', {
          tabId: tabKey,
          state: 'HANDOFF_IN_PROGRESS',
          fingerprintHash: fingerprintDiagHash(fingerprint),
        });
        return;
      }
      if (findPendingForFingerprint(slice, fingerprint)) {
        logBrowserCta('rediscovery_suppressed', {
          tabId: tabKey,
          state: 'HANDOFF_IN_PROGRESS',
          fingerprintHash: fingerprintDiagHash(fingerprint),
        });
        return;
      }
    }

    if (isConsumedInSlice(slice, tabKey, fingerprint, handoff.contentIdentity)) {
      logBrowserCta('rediscovery_suppressed', {
        tabId: tabKey,
        state: 'CONSUMED',
        fingerprintHash: fingerprintDiagHash(fingerprint),
        pageUrl: handoff.pageUrl,
      });
      if (slice.state.status !== 'consumed') {
        patchActive({
          status: 'consumed',
          ...clearExecutableOfferFields(),
          pageUrl: handoff.pageUrl,
          contentIdentity: handoff.contentIdentity ?? slice.state.contentIdentity,
        });
      }
      return;
    }

    if (slice.state.selectionLocked && slice.state.mediaFingerprint === fingerprint) {
      return;
    }

    // Do not clobber an in-progress preparing UI for a different claim on same page.
    if (
      slice.state.status === 'preparing' &&
      slice.state.mediaFingerprint &&
      slice.state.mediaFingerprint !== fingerprint
    ) {
      return;
    }

    slice.verifiedCandidateId = handoff.media.id;
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    if (handoff.contentIdentity) {
      slice.verdicts.delete(handoff.contentIdentity);
    }

    patchActive({
      status: 'verified',
      pageUrl: handoff.pageUrl,
      media: handoff.media,
      analysis: handoff.analysis,
      // Phase 6C: never retain raw Cookie/Authorization in long-lived CTA/quality state.
      requestContext: sanitizeHandoffRequestContext(handoff.requestContext),
      mediaUrl: handoff.mediaUrl,
      mediaFingerprint: fingerprint,
      contentIdentity: handoff.contentIdentity ?? null,
      variantIdentity: handoff.variantIdentity ?? null,
      errorMessage: null,
      autoShownOnce: handoff.autoShow ? false : slice.state.autoShownOnce,
      dismissed: false,
      selectionLocked: false,
      downloadId: null,
      downloadProgress: null,
    });

    logBrowserCta('available', {
      tabId: tabKey,
      pageUrl: handoff.pageUrl,
      fingerprintHash: fingerprintDiagHash(fingerprint),
      state: 'AVAILABLE',
    });
    logBrowserCta('media_available', {
      tabId: tabKey,
      pageUrl: handoff.pageUrl,
      fingerprintHash: fingerprintDiagHash(fingerprint),
      state: 'AVAILABLE',
    });
  },

  markAutoShown(): void {
    patchActive({ autoShownOnce: true });
  },

  dismiss(): void {
    patchActive({ dismissed: true });
  },

  setStatus(status: BrowserMediaActionStatus, errorMessage?: string | null): void {
    patchActive({
      status,
      errorMessage: errorMessage ?? null,
    });
  },

  /**
   * Atomic AVAILABLE → HANDOFF_IN_PROGRESS before any await.
   * Captures tabId + generation so late results cannot corrupt other tabs/media.
   */
  claimForHandoff(): BrowserMediaHandoffClaim {
    const tabId = activeTabId ?? '__default__';
    const slice = ensureSlice(tabId);
    const { state } = slice;

    if (state.selectionLocked) {
      logBrowserCta('handoff_duplicate_blocked', {
        tabId,
        state: 'SELECTION_LOCKED',
        fingerprintHash: fingerprintDiagHash(state.mediaFingerprint),
      });
      return { outcome: 'SELECTION_LOCKED' };
    }

    if (state.status === 'consumed' || state.status === 'completed' || state.status === 'downloading') {
      return { outcome: 'ALREADY_CONSUMED' };
    }

    const offerReady =
      state.status === 'verified' ||
      (state.status === 'failed' && Boolean(state.analysis && state.requestContext));

    if (!offerReady && state.status !== 'preparing') {
      return { outcome: 'NOT_AVAILABLE' };
    }

    const fingerprint = state.mediaFingerprint;
    const analysis = state.analysis;
    const requestContext = state.requestContext;
    if (!fingerprint || !analysis || !requestContext) {
      return { outcome: 'NOT_AVAILABLE' };
    }

    if (findPendingForFingerprint(slice, fingerprint) || state.status === 'preparing') {
      logBrowserCta('handoff_duplicate_blocked', {
        tabId,
        state: 'HANDOFF_IN_PROGRESS',
        fingerprintHash: fingerprintDiagHash(fingerprint),
      });
      return { outcome: 'ALREADY_IN_PROGRESS' };
    }

    if (isConsumedInSlice(slice, tabId, fingerprint, state.contentIdentity)) {
      return { outcome: 'ALREADY_CONSUMED' };
    }

    const generation = slice.handoffGeneration + 1;
    slice.handoffGeneration = generation;
    slice.pendingHandoffs.set(generation, {
      generation,
      fingerprint,
      tabId,
      pageUrl: state.pageUrl,
    });

    // Synchronous transition — closes double-tap window before await.
    slice.state = {
      ...state,
      status: 'preparing',
      errorMessage: null,
      selectionLocked: false,
    };
    emit();

    logBrowserCta('handoff_claimed', {
      tabId,
      pageUrl: state.pageUrl,
      fingerprintHash: fingerprintDiagHash(fingerprint),
      handoffGeneration: generation,
      state: 'HANDOFF_IN_PROGRESS',
    });

    return {
      outcome: 'CLAIMED',
      handoffGeneration: generation,
      tabId,
      fingerprint,
      analysis,
      requestContext,
      mediaUrl: state.mediaUrl,
      pageUrl: state.pageUrl,
      contentIdentity: state.contentIdentity,
      variantIdentity: state.variantIdentity,
    };
  },

  /**
   * Lock quality-sheet interaction without consuming.
   * Cancel restores AVAILABLE; only enqueue success consumes.
   * Optional generation freeze captures SPA/page scope at lock time.
   */
  beginQualitySelection(input?: {
    navigationEpoch: number;
    pageGeneration?: number | null;
    socialContextGeneration?: number | null;
  }): BrowserMediaSelectionClaim {
    const tabId = activeTabId ?? '__default__';
    const slice = ensureSlice(tabId);
    const { state } = slice;

    if (state.status === 'preparing' || findPendingForFingerprint(slice, state.mediaFingerprint ?? '')) {
      return { outcome: 'ALREADY_IN_PROGRESS' };
    }
    if (state.selectionLocked) {
      logBrowserCta('handoff_duplicate_blocked', {
        tabId,
        state: 'SELECTION_LOCKED',
        result: 'duplicate_sheet',
        fingerprintHash: fingerprintDiagHash(state.mediaFingerprint),
      });
      return { outcome: 'ALREADY_LOCKED' };
    }
    if (state.status === 'consumed') {
      return { outcome: 'ALREADY_CONSUMED' };
    }
    if (state.status !== 'verified' || !state.mediaFingerprint || !state.analysis) {
      return { outcome: 'NOT_AVAILABLE' };
    }
    if (isConsumedInSlice(slice, tabId, state.mediaFingerprint, state.contentIdentity)) {
      return { outcome: 'ALREADY_CONSUMED' };
    }

    const selectionGeneration = slice.selectionGeneration + 1;
    slice.selectionGeneration = selectionGeneration;
    const freeze: BrowserMediaQualityFreeze = {
      fingerprint: state.mediaFingerprint,
      contentIdentity: state.contentIdentity,
      variantIdentity: state.variantIdentity,
      pageUrl: state.pageUrl,
      navigationEpoch: input?.navigationEpoch ?? 0,
      pageGeneration: input?.pageGeneration ?? null,
      socialContextGeneration: input?.socialContextGeneration ?? null,
    };
    slice.qualityFreeze = freeze;
    slice.state = { ...state, selectionLocked: true, errorMessage: null };
    emit();

    logBrowserCta('quality_selection_locked', {
      tabId,
      fingerprintHash: fingerprintDiagHash(state.mediaFingerprint),
      handoffGeneration: selectionGeneration,
      state: 'AVAILABLE',
    });

    return {
      outcome: 'LOCKED',
      selectionGeneration,
      tabId,
      fingerprint: state.mediaFingerprint,
      freeze,
    };
  },

  getQualitySelectionFreeze(tabId?: string | null): BrowserMediaQualityFreeze | null {
    const id = tabId ?? activeTabId ?? '__default__';
    return slices.get(id)?.qualityFreeze ?? null;
  },

  /**
   * True when frozen quality-sheet scope still matches the active CTA offer.
   * Callers must also compare page/social generation against their context stores.
   */
  isQualitySelectionOfferCurrent(tabId?: string | null): boolean {
    const id = tabId ?? activeTabId ?? '__default__';
    const slice = slices.get(id);
    if (!slice?.qualityFreeze || !slice.state.selectionLocked) {
      return false;
    }
    const freeze = slice.qualityFreeze;
    if (slice.state.mediaFingerprint !== freeze.fingerprint) {
      return false;
    }
    if (
      freeze.contentIdentity &&
      slice.state.contentIdentity &&
      freeze.contentIdentity !== slice.state.contentIdentity
    ) {
      return false;
    }
    return true;
  },

  endQualitySelection(tabId?: string | null): void {
    const id = tabId ?? activeTabId ?? '__default__';
    const slice = slices.get(id);
    if (!slice) {
      return;
    }
    if (!slice.state.selectionLocked) {
      return;
    }
    slice.qualityFreeze = null;
    if (slice.state.analysis && slice.state.requestContext && slice.state.mediaFingerprint) {
      slice.state = {
        ...slice.state,
        selectionLocked: false,
        status: 'verified',
        errorMessage: null,
      };
    } else {
      slice.state = {
        ...slice.state,
        selectionLocked: false,
        status: 'idle',
      };
    }
    logBrowserCta('quality_cancelled', {
      tabId: id,
      fingerprintHash: fingerprintDiagHash(slice.state.mediaFingerprint),
      state: slice.state.status === 'verified' ? 'AVAILABLE' : undefined,
    });
    emit();
  },

  /**
   * A download this browser started failed because its link must be fetched fresh from the page (expired, refused,
   * gone). Its video is no longer "already in your downloads": the page may offer it again with the link it has now,
   * which is exactly what the failure message tells the user to do. Returns whether anything was released.
   */
  releaseConsumedDownload(downloadId: string): boolean {
    let released = false;
    for (const [tabId, slice] of slices) {
      const consumed = slice.consumedDownloads.get(downloadId);
      if (!consumed) {
        continue;
      }
      slice.consumedDownloads.delete(downloadId);
      slice.consumedFingerprints.delete(consumed.fingerprint);
      slice.consumedFingerprints.delete(buildTabScopedConsumptionKey(tabId, consumed.fingerprint));
      slice.consumedOutcomes.delete(buildTabScopedConsumptionKey(tabId, consumed.fingerprint));
      if (consumed.contentIdentity) {
        slice.consumedFingerprints.delete(buildContentConsumptionKey(tabId, consumed.contentIdentity));
        slice.consumedOutcomes.delete(buildContentConsumptionKey(tabId, consumed.contentIdentity));
      }
      if (slice.state.status === 'consumed' && slice.state.downloadId === downloadId) {
        slice.verifiedCandidateId = null;
        slice.state = { ...slice.state, status: 'idle', downloadId: null };
      }
      logBrowserCta('consumed_released', {
        tabId,
        fingerprintHash: fingerprintDiagHash(consumed.fingerprint),
        result: 'source_needs_refresh',
      });
      released = true;
      if (activeTabId === tabId) {
        emit();
      }
    }
    return released;
  },

  /**
   * Phase 1 accepted the job — CONSUMED for this tab/page/media identity.
   * Only matching handoff generation may commit (stale async ignored).
   */
  commitConsumed(
    tabId: string,
    fingerprint: string,
    handoffGeneration: number,
    downloadId?: string | null,
    duplicate?: BrowserConsumedDuplicate,
  ): boolean {
    const slice = slices.get(tabId);
    if (!slice) {
      logBrowserCta('stale_result_ignored', {
        tabId,
        result: 'tab_gone',
        handoffGeneration,
        fingerprintHash: fingerprintDiagHash(fingerprint),
      });
      return false;
    }

    const active = slice.pendingHandoffs.get(handoffGeneration);

    // Quality-sheet path: selectionLocked, no pending handoff generation from claimForHandoff.
    if (!active) {
      if (slice.state.selectionLocked && slice.state.mediaFingerprint === fingerprint) {
        const contentIdentity = slice.state.contentIdentity;
        addConsumed(slice, fingerprint, tabId, contentIdentity);
        rememberConsumedDownload(slice, downloadId, fingerprint, contentIdentity);
        rememberConsumedOutcome(slice, tabId, fingerprint, contentIdentity, downloadId, duplicate);
        slice.verifiedCandidateId = null;
        slice.verificationAbort?.abort();
        slice.verificationAbort = null;
        slice.qualityFreeze = null;
        slice.state = {
          ...slice.state,
          status: 'consumed',
          ...clearExecutableOfferFields(),
          contentIdentity,
          downloadId: downloadId ?? null,
        };
        logBrowserCta('consumed', {
          tabId,
          fingerprintHash: fingerprintDiagHash(fingerprint),
          handoffGeneration,
          result: 'quality_path',
          state: 'CONSUMED',
        });
        if (activeTabId === tabId) {
          emit();
        }
        return true;
      }

      logBrowserCta('stale_result_ignored', {
        tabId,
        result: 'generation_mismatch',
        handoffGeneration,
        fingerprintHash: fingerprintDiagHash(fingerprint),
      });
      return false;
    }

    if (active.fingerprint !== fingerprint || active.tabId !== tabId) {
      logBrowserCta('stale_result_ignored', {
        tabId,
        result: 'identity_mismatch',
        handoffGeneration,
        fingerprintHash: fingerprintDiagHash(fingerprint),
      });
      return false;
    }

    slice.pendingHandoffs.delete(handoffGeneration);
    const contentIdentity = slice.state.contentIdentity;
    addConsumed(slice, fingerprint, tabId, contentIdentity);
    rememberConsumedDownload(slice, downloadId, fingerprint, contentIdentity);
    rememberConsumedOutcome(slice, tabId, fingerprint, contentIdentity, downloadId, duplicate);
    slice.verifiedCandidateId = null;
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;

    // If navigation already moved to a different offer, only record consumption —
    // do not clobber the new media's AVAILABLE state.
    const stillSameOffer = slice.state.mediaFingerprint === fingerprint;

    if (stillSameOffer) {
      slice.state = {
        ...slice.state,
        status: 'consumed',
        ...clearExecutableOfferFields(),
        contentIdentity,
        downloadId: downloadId ?? null,
      };
    }

    logBrowserCta('consumed', {
      tabId,
      fingerprintHash: fingerprintDiagHash(fingerprint),
      handoffGeneration,
      result: stillSameOffer ? 'ui_consumed' : 'fingerprint_only',
      state: 'CONSUMED',
    });

    if (activeTabId === tabId) {
      emit();
    }
    return true;
  },

  /**
   * Immediate pre-enqueue failure — restore AVAILABLE if offer still valid.
   */
  releaseHandoff(
    tabId: string,
    fingerprint: string,
    handoffGeneration: number,
    message?: string | null,
  ): void {
    const slice = slices.get(tabId);
    if (!slice) {
      return;
    }
    const active = slice.pendingHandoffs.get(handoffGeneration);
    if (!active || active.fingerprint !== fingerprint) {
      logBrowserCta('stale_result_ignored', {
        tabId,
        result: 'release_mismatch',
        handoffGeneration,
        fingerprintHash: fingerprintDiagHash(fingerprint),
      });
      return;
    }

    slice.pendingHandoffs.delete(handoffGeneration);

    const stillSameOffer =
      slice.state.mediaFingerprint === fingerprint &&
      Boolean(slice.state.analysis && slice.state.requestContext);

    if (stillSameOffer) {
      slice.state = {
        ...slice.state,
        status: 'verified',
        errorMessage: message ?? 'Could not start download.',
        selectionLocked: false,
        downloadId: null,
        downloadProgress: null,
      };
      logBrowserCta('handoff_released', {
        tabId,
        fingerprintHash: fingerprintDiagHash(fingerprint),
        handoffGeneration,
        state: 'AVAILABLE',
        result: 'retryable',
      });
    } else if (slice.state.status === 'preparing') {
      slice.state = {
        ...initialBrowserMediaActionState,
        pageUrl: slice.state.pageUrl,
        status: 'idle',
      };
      logBrowserCta('handoff_released', {
        tabId,
        fingerprintHash: fingerprintDiagHash(fingerprint),
        handoffGeneration,
        state: 'NONE',
        result: 'stale_offer',
      });
    } else {
      logBrowserCta('handoff_released', {
        tabId,
        fingerprintHash: fingerprintDiagHash(fingerprint),
        handoffGeneration,
        state: toStatusLabel(slice.state.status),
        result: 'no_ui_change',
      });
    }

    if (activeTabId === tabId) {
      emit();
    }
  },

  /** @deprecated Prefer commitConsumed with claim identity. */
  markConsumed(fingerprint: string | null | undefined): void {
    const slice = requireActiveSlice();
    const tabKey = activeTabId ?? '__default__';
    const fp = fingerprint?.trim() || slice.state.mediaFingerprint;
    if (fp) {
      addConsumed(slice, fp, tabKey, slice.state.contentIdentity);
      for (const [gen, handoff] of slice.pendingHandoffs) {
        if (handoff.fingerprint === fp) {
          slice.pendingHandoffs.delete(gen);
        }
      }
    }
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verifiedCandidateId = null;
    patchActive({
      status: 'consumed',
      ...clearExecutableOfferFields(),
    });
    logBrowserCta('consumed', {
      tabId: tabKey,
      fingerprintHash: fingerprintDiagHash(fp),
      state: 'CONSUMED',
      result: 'legacy_markConsumed',
    });
  },

  /**
   * Quality-sheet success: consume using selection lock identity (tab-scoped).
   */
  commitQualityConsumed(fingerprint: string | null | undefined, downloadId?: string | null): boolean {
    const tabId = activeTabId ?? '__default__';
    const slice = slices.get(tabId);
    if (!slice) {
      return false;
    }
    const fp = fingerprint?.trim() || slice.state.mediaFingerprint;
    if (!fp) {
      return false;
    }
    return this.commitConsumed(tabId, fp, -1, downloadId);
  },

  bindDownload(downloadId: string, _progress: number | null = null): void {
    void _progress;
    if (downloadId && this.getState().status === 'consumed') {
      patchActive({ downloadId });
    }
  },

  updateDownloadProgress(_progress: number): void {
    void _progress;
  },

  /**
   * Phase 1 COMPLETED must not drive CTA. Consumption already happened at enqueue.
   */
  markCompleted(downloadId: string): void {
    if (downloadId && this.getState().status === 'consumed') {
      patchActive({ downloadId, downloadProgress: 100 });
    }
  },

  markFailed(message: string): void {
    const slice = requireActiveSlice();
    const pending = firstPending(slice);
    if (pending && slice.state.status === 'preparing') {
      this.releaseHandoff(pending.tabId, pending.fingerprint, pending.generation, message);
      return;
    }
    if (slice.state.analysis && slice.state.requestContext && slice.state.mediaFingerprint) {
      patchActive({
        status: 'verified',
        errorMessage: message,
        downloadId: null,
        downloadProgress: null,
        selectionLocked: false,
      });
      return;
    }
    patchActive({
      status: 'failed',
      errorMessage: message,
      selectionLocked: false,
    });
  },

  beginVerification(contentIdentity: string | null = null): AbortSignal {
    const slice = requireActiveSlice();
    slice.verificationAbort?.abort();
    slice.verificationAbort = new AbortController();
    slice.verificationContentIdentity = contentIdentity;
    // The video is being looked at again (a new candidate): whatever it was answered before is not final.
    if (contentIdentity && slice.verdicts.delete(contentIdentity)) {
      emit();
    }
    return slice.verificationAbort.signal;
  },

  cancelVerification(): void {
    const slice = requireActiveSlice();
    slice.verificationAbort?.abort();
    slice.verificationAbort = null;
    slice.verificationContentIdentity = null;
  },

  handoffVerified(handoff: BrowserMediaVerifiedHandoff): void {
    this.setVerified(handoff);
  },

  /** Verification proved the video with this identity (on the active tab's page) protected or unsupported. */
  recordVerdict(contentIdentity: string | null | undefined, verdict: BrowserMediaCurrentVerdict): void {
    if (!contentIdentity) {
      return;
    }
    const slice = requireActiveSlice();
    if (slice.verdicts.get(contentIdentity)?.verdict === verdict) {
      return;
    }
    slice.verdicts.delete(contentIdentity);
    const entry = { verdict, since: Date.now() };
    slice.verdicts.set(contentIdentity, entry);
    while (slice.verdicts.size > MAX_VERDICTS_PER_TAB) {
      const oldest = slice.verdicts.keys().next().value;
      if (oldest === undefined) break;
      slice.verdicts.delete(oldest);
    }
    // Presented once it has stood (see getVerdict): re-render then, if it still stands.
    setTimeout(() => {
      if (slice.verdicts.get(contentIdentity) === entry) {
        emit();
      }
    }, NEGATIVE_VERDICT_SETTLE_MS);
  },

  /** A verification of this video is running right now (its candidate is being checked). */
  isVerifying(contentIdentity: string | null | undefined): boolean {
    if (!contentIdentity) {
      return false;
    }
    const slice = requireActiveSlice();
    return (
      slice.state.status === 'detecting' &&
      slice.verificationContentIdentity === contentIdentity &&
      Boolean(slice.verificationAbort) &&
      !slice.verificationAbort!.signal.aborted
    );
  },

  /**
   * A negative verdict for this video that has not stood long enough to be its answer: the video is still being
   * resolved (the action area says "Detecting video…", never the not-yet-final verdict).
   */
  hasPendingVerdict(contentIdentity: string | null | undefined, now: number = Date.now()): boolean {
    if (!contentIdentity) {
      return false;
    }
    const entry = requireActiveSlice().verdicts.get(contentIdentity);
    return Boolean(entry) && now - entry!.since < NEGATIVE_VERDICT_SETTLE_MS;
  },

  /**
   * The video's final negative verdict: recorded at least NEGATIVE_VERDICT_SETTLE_MS ago and not superseded since (an
   * offer for it, a new verification of it). A fresher one is not an answer yet.
   */
  getVerdict(
    contentIdentity: string | null | undefined,
    now: number = Date.now(),
  ): BrowserMediaCurrentVerdict | null {
    if (!contentIdentity) {
      return null;
    }
    const entry = requireActiveSlice().verdicts.get(contentIdentity);
    return entry && now - entry.since >= NEGATIVE_VERDICT_SETTLE_MS ? entry.verdict : null;
  },

  /**
   * The engine says the user already had the offer with this fingerprint before any tap: in the library
   * (DOWNLOADED) or as a download under way (DOWNLOADING — never "already downloaded" while it is still running).
   */
  markOfferDuplicate(
    fingerprint: string | null | undefined,
    kind: BrowserOfferDuplicate['kind'] = 'DOWNLOADED',
    downloadId: string | null = null,
  ): void {
    if (!fingerprint) {
      return;
    }
    const slice = requireActiveSlice();
    const previous = slice.duplicateOffers.get(fingerprint);
    if (previous && previous.kind === kind && previous.downloadId === downloadId) {
      return;
    }
    slice.duplicateOffers.delete(fingerprint);
    slice.duplicateOffers.set(fingerprint, { kind, downloadId });
    if (slice.duplicateOffers.size > MAX_CONSUMED_PER_TAB) {
      const oldest = slice.duplicateOffers.keys().next().value;
      if (oldest !== undefined) slice.duplicateOffers.delete(oldest);
    }
    emit();
  },

  /** True only when the offer's video was already fully downloaded before this page offered it. */
  isOfferDuplicate(fingerprint: string | null | undefined): boolean {
    return Boolean(fingerprint) && requireActiveSlice().duplicateOffers.get(fingerprint!)?.kind === 'DOWNLOADED';
  },

  getOfferDuplicate(fingerprint: string | null | undefined): BrowserOfferDuplicate | null {
    return fingerprint ? (requireActiveSlice().duplicateOffers.get(fingerprint) ?? null) : null;
  },

  /** What the consumption of this video (by content identity, else fingerprint) resulted in, on the active tab. */
  getConsumedOutcome(
    contentIdentity: string | null | undefined,
    fingerprint?: string | null,
  ): BrowserConsumedOutcome | null {
    const tabKey = activeTabId ?? '__default__';
    const slice = requireActiveSlice();
    if (contentIdentity) {
      const byContent = slice.consumedOutcomes.get(buildContentConsumptionKey(tabKey, contentIdentity));
      if (byContent) return byContent;
    }
    if (fingerprint) {
      const byFingerprint = slice.consumedOutcomes.get(buildTabScopedConsumptionKey(tabKey, fingerprint));
      if (byFingerprint) return byFingerprint;
    }
    // A page video without a content identity: the tab's consumed state is that consumption.
    return slice.state.status === 'consumed' ? slice.lastConsumedOutcome : null;
  },

  /**
   * The user scrolled from this video to another one: when they come back, its finished download is something they
   * already have ("Already downloaded"), not the download that just finished in front of them ("Downloaded").
   */
  markConsumedRevisitable(contentIdentity: string | null | undefined): void {
    if (!contentIdentity) {
      return;
    }
    const outcome = requireActiveSlice().consumedOutcomes.get(
      buildContentConsumptionKey(activeTabId ?? '__default__', contentIdentity),
    );
    if (outcome && !outcome.revisited) {
      outcome.revisited = true;
    }
  },

  /** Test helper */
  __resetAllForTests(): void {
    slices.clear();
    activeTabId = '__default__';
    emit();
  },

  /** Test helper */
  __getPendingHandoffCountForTests(): number {
    return requireActiveSlice().pendingHandoffs.size;
  },
} as const;
