/**
 * Phase 3E — derived Browser Download CTA presentation.
 * Presentation-only: never invents metadata, never owns download/lifecycle state.
 */
import type { MediaAnalysisResult } from '@/api/types';
import { labelFromHeight } from '@/media-detection/quality/quality.resolver';
import {
  resolveSocialPlatform,
  socialPageContextStore,
} from '@/media-detection/social';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import type { DetectedMedia } from '@/media-detection/types';
import { formatFileSize, isSafeMediaUrl, isSameDocumentUrl } from '@/media-detection/utils';

import {
  shouldHideStickyOfferForLiveIdentity,
  type OwnershipConfidence,
} from './cta-persistence';
import {
  isActionableCtaShell,
  resolveCtaShellPresentation,
  shouldKeepCtaShellMounted,
  type CtaShellPresentationState,
} from './cta-shell-presentation';
import type { BrowserMediaActionState } from './browser-media-action.types';

export type BrowserDownloadPresentation = {
  candidateId: string | null;
  tabId: string | null;
  pageUrl: string | null;

  isEligible: boolean;
  /** Hide final card but allow toast/failure chrome. */
  showCard: boolean;
  shellState: CtaShellPresentationState;

  eyebrow: string;
  title: string;

  format: string | null;
  sizeLabel: string | null;
  qualityLabel: string | null;
  audioLabel: string | null;
  /** Dynamic ` • `-joined metadata; null when nothing known. */
  metaLine: string | null;

  thumbnailUri: string | null;

  buttonLabel: string;
  buttonDisabled: boolean;
  isPreparing: boolean;
  isFailureHint: boolean;
  failureMessage: string | null;

  accessibilityEyebrow: string;
  accessibilityTitle: string;
  accessibilityMeta: string | null;
  accessibilityButton: string;
};

export type BrowserDownloadPresentationInput = {
  actionState: BrowserMediaActionState;
  activeTabId: string | null;
  isHome: boolean;
  hasBrowserError: boolean;
  /** Tab switcher / full-screen overlays that own presentation. */
  overlayBlocking: boolean;
  /** Current active-tab document URL (navigation epoch ownership). */
  currentPageUrl: string | null;
  hasDownloadableOptions: boolean;
  liveContentIdentity?: string | null;
  liveOwnershipConfidence?: OwnershipConfidence;
  liveIdentityConsumed?: boolean;
};

const TITLE_MAX_LEN = 64;

const FORMAT_FROM_MIME: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
  'video/quicktime': 'MOV',
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
  'audio/aac': 'AAC',
  'audio/ogg': 'OGG',
  'application/vnd.apple.mpegurl': 'HLS',
  'application/x-mpegurl': 'HLS',
};

const FORMAT_FROM_CONTAINER: Record<string, string> = {
  mp4: 'MP4',
  webm: 'WEBM',
  mov: 'MOV',
  m4v: 'MP4',
  mp3: 'MP3',
  m4a: 'M4A',
  aac: 'AAC',
  ogg: 'OGG',
  hls: 'HLS',
};

/** Reject targets that must never become Download Video. */
export function isRejectedDownloadTarget(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return true;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('blob:') || lower.startsWith('data:') || lower.startsWith('javascript:')) {
    return true;
  }
  try {
    const path = new URL(trimmed).pathname.toLowerCase();
    if (/\.m4s$/i.test(path)) {
      return true;
    }
    // Bare media segments — not playlists.
    if (/\.ts$/i.test(path) && !/\.m3u8?$/i.test(path)) {
      return true;
    }
  } catch {
    if (/\.m4s(\?|$)/i.test(lower) || /\.ts(\?|$)/i.test(lower)) {
      return true;
    }
  }
  return false;
}

export function isLikelyThumbnailOrPosterOnly(media: DetectedMedia | null): boolean {
  if (!media) {
    return false;
  }
  if (media.mimeType?.startsWith('image/')) {
    return true;
  }
  if (media.category === 'video' || media.category === 'stream' || media.category === 'audio') {
    return false;
  }
  return true;
}

export function formatDownloadSizeLabel(
  bytes: number | null | undefined,
): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  return formatFileSize(bytes);
}

/**
 * Parse analysis.fileSize (byte-count string) or positive variant estimates.
 * Never returns 0 / NaN labels.
 */
export function resolveVerifiedSizeBytes(
  analysis: MediaAnalysisResult | null,
): number | null {
  if (!analysis) {
    return null;
  }
  const raw = analysis.fileSize?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  const variantSize = analysis.variants?.find(
    (v) => typeof v.estimatedFileSize === 'number' && v.estimatedFileSize > 0,
  )?.estimatedFileSize;
  if (typeof variantSize === 'number' && Number.isFinite(variantSize) && variantSize > 0) {
    return variantSize;
  }
  return null;
}

export function formatDownloadFormatLabel(
  analysis: MediaAnalysisResult | null,
  media: DetectedMedia | null,
): string | null {
  const mime = (analysis?.mimeType ?? media?.mimeType ?? null)?.split(';')[0]?.trim().toLowerCase();
  if (mime && FORMAT_FROM_MIME[mime]) {
    return FORMAT_FROM_MIME[mime];
  }
  const container = (analysis?.container ?? media?.container ?? 'unknown').toLowerCase();
  if (container && container !== 'unknown' && FORMAT_FROM_CONTAINER[container]) {
    return FORMAT_FROM_CONTAINER[container];
  }
  if (mime?.startsWith('video/') || mime?.startsWith('audio/')) {
    const subtype = mime.split('/')[1]?.toUpperCase();
    if (subtype && subtype.length <= 8 && /^[A-Z0-9.+-]+$/.test(subtype)) {
      return subtype;
    }
  }
  return null;
}

export function formatDownloadQualityLabel(
  analysis: MediaAnalysisResult | null,
  media: DetectedMedia | null,
): string | null {
  const width = analysis?.width ?? media?.width ?? null;
  const height = analysis?.height ?? media?.height ?? null;
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    width > 0 &&
    height > 0
  ) {
    // Portrait and landscape both map via the shorter edge (1080x1920 → 1080p).
    const label = labelFromHeight(Math.min(width, height));
    return label && label !== 'Original' ? label : null;
  }

  const resolution = (analysis?.resolution ?? media?.resolution ?? null)?.trim();
  if (!resolution) {
    return null;
  }
  if (/^\d{3,4}p$/i.test(resolution)) {
    return resolution.toLowerCase();
  }
  if (/^4k$/i.test(resolution) || /^2160p$/i.test(resolution)) {
    return '2160p';
  }
  const match = /^([1-9]\d{1,4})\s*[x×]\s*([1-9]\d{1,4})$/i.exec(resolution);
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    const label = labelFromHeight(Math.min(w, h));
    return label && label !== 'Original' ? label : null;
  }
  return null;
}

/**
 * Audio row only when presence/absence is evidenced — never inferred from MP4 alone.
 */
export function formatDownloadAudioLabel(
  analysis: MediaAnalysisResult | null,
  media: DetectedMedia | null,
): string | null {
  if (analysis?.mediaType === 'audio' || media?.category === 'audio') {
    return null;
  }
  // Separate DASH A/V — never misrepresent as combined audio.
  if (media?.videoOnly && media?.hasSeparateAudio) {
    return null;
  }
  if (media?.videoOnly === true) {
    return 'Video Only';
  }
  const codec =
    media?.audioCodec?.trim() ||
    analysis?.variants?.find((v) => v.audioCodec?.trim())?.audioCodec?.trim() ||
    null;
  if (codec) {
    return 'Audio Included';
  }
  return null;
}

function sanitizeTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return 'Video';
  }
  if (collapsed.length <= TITLE_MAX_LEN) {
    return collapsed;
  }
  return `${collapsed.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…`;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function resolvePlatformKey(
  analysis: MediaAnalysisResult | null,
  pageUrl: string | null,
): string {
  const fromAnalysis = analysis?.platform?.trim().toUpperCase();
  if (
    fromAnalysis &&
    fromAnalysis !== 'OTHER' &&
    /^[A-Z][A-Z0-9_]{0,30}$/.test(fromAnalysis)
  ) {
    return fromAnalysis;
  }
  const host = hostOf(pageUrl);
  if (!host) {
    return 'OTHER';
  }
  if (host.includes('instagram')) {
    return 'INSTAGRAM';
  }
  if (host.includes('tiktok')) {
    return 'TIKTOK';
  }
  if (host.includes('facebook') || host === 'fb.watch' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    return 'FACEBOOK';
  }
  if (host === 'x.com' || host.includes('twitter')) {
    return 'X';
  }
  if (host.includes('reddit')) {
    return 'REDDIT';
  }
  if (host.includes('pinterest')) {
    return 'PINTEREST';
  }
  if (host.includes('vimeo')) {
    return 'VIMEO';
  }
  if (host.includes('dailymotion')) {
    return 'DAILYMOTION';
  }
  if (host.includes('youtube') || host === 'youtu.be') {
    return 'YOUTUBE';
  }
  return 'OTHER';
}

/**
 * Platform / content title for the card.
 * "Reel" only when path evidence identifies a reel — never guessed from page title.
 */
export function resolveDownloadPlatformTitle(
  analysis: MediaAnalysisResult | null,
  pageUrl: string | null,
  media: DetectedMedia | null,
): string {
  if (analysis?.mediaType === 'audio' || media?.category === 'audio') {
    return 'Audio';
  }

  const platform = resolvePlatformKey(analysis, pageUrl);
  const path = pathOf(pageUrl);

  switch (platform) {
    case 'INSTAGRAM':
      return /^\/reel\//i.test(path) ? 'Instagram Reel' : 'Instagram Video';
    case 'TIKTOK':
      return 'TikTok Video';
    case 'FACEBOOK':
      return 'Facebook Video';
    case 'X':
      return 'X Video';
    case 'REDDIT':
      return 'Reddit Video';
    case 'PINTEREST':
      return 'Pinterest Video';
    case 'VIMEO':
      return 'Vimeo Video';
    case 'DAILYMOTION':
      return 'Dailymotion Video';
    case 'YOUTUBE':
      return 'YouTube Video';
    default:
      return 'Video';
  }
}

export function buildMetadataLine(parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim()));
  return filtered.length > 0 ? filtered.join(' • ') : null;
}

export function resolveSafeThumbnailUri(
  analysis: MediaAnalysisResult | null,
  media: DetectedMedia | null,
): string | null {
  const uri = analysis?.thumbnailUrl ?? media?.thumbnailUrl ?? null;
  if (!uri || !isSafeMediaUrl(uri)) {
    return null;
  }
  // Thumbnail must never be confused with the download target.
  if (isRejectedDownloadTarget(uri)) {
    return null;
  }
  return uri;
}

/**
 * Deterministic live-owner strength for sticky CTA presentation.
 * Canonical social ids and clearly visible players count as strong enough
 * to replace A → B. Weak intersection dips do not.
 */
export function resolveLivePresentationOwnership(
  input: {
    canonicalContentId?: string | null;
    identityConfidence?: OwnershipConfidence | string | null;
    intersectionRatio?: number | null;
    recentlyPlayed?: boolean;
  },
): OwnershipConfidence {
  if (input.canonicalContentId) {
    if (input.identityConfidence === 'STRONG') {
      return 'STRONG';
    }
    return 'MEDIUM';
  }
  const ratio = input.intersectionRatio;
  if (typeof ratio === 'number' && ratio >= 0.55) {
    return 'MEDIUM';
  }
  if (
    input.recentlyPlayed &&
    typeof ratio === 'number' &&
    ratio >= 0.35
  ) {
    return 'MEDIUM';
  }
  if (typeof ratio === 'number' && ratio > 0) {
    return 'WEAK';
  }
  return null;
}

/**
 * Strict CTA eligibility for the final Download card.
 * Upstream verification remains source of truth; this only gates presentation.
 */
export function isBrowserDownloadCtaEligible(
  input: BrowserDownloadPresentationInput,
): boolean {
  const { actionState, isHome, hasBrowserError, overlayBlocking, currentPageUrl, activeTabId } =
    input;

  if (isHome || hasBrowserError || overlayBlocking) {
    return false;
  }

  const status = actionState.status;
  if (status === 'idle' || status === 'detecting' || status === 'consumed' || status === 'completed') {
    return false;
  }

  const offerActive =
    status === 'verified' ||
    status === 'preparing' ||
    (status === 'failed' && Boolean(actionState.errorMessage));

  if (!offerActive) {
    return false;
  }

  if (!actionState.analysis || !actionState.mediaFingerprint) {
    return false;
  }

  if (!actionState.analysis.downloadable && !(actionState.analysis.variants ?? []).some((v) => v.downloadable)) {
    return false;
  }

  const mediaUrl = actionState.mediaUrl ?? actionState.analysis.finalUrl ?? null;
  if (isRejectedDownloadTarget(mediaUrl)) {
    return false;
  }

  if (isLikelyThumbnailOrPosterOnly(actionState.media)) {
    return false;
  }

  // Page / navigation ownership — stale previous-page offers must not render.
  if (actionState.pageUrl && currentPageUrl) {
    if (!isSameDocumentUrl(actionState.pageUrl, currentPageUrl)) {
      return false;
    }
  }

  // Social / general feed: hide sticky A only when B is a strong live owner.
  // Transient identity noise / intersection dips must not blank the CTA.
  if (actionState.contentIdentity && currentPageUrl) {
    const tabId = activeTabId ?? '__default__';
    if (resolveSocialPlatform(currentPageUrl)) {
      const ctx = socialPageContextStore.get(tabId);
      const liveIdentity =
        ctx?.currentVisibleMediaIdentity ??
        (ctx?.canonicalContentId
          ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
          : null);
      const liveOwnershipConfidence = resolveLivePresentationOwnership({
        canonicalContentId: ctx?.canonicalContentId,
        identityConfidence: ctx?.identityConfidence,
        intersectionRatio: ctx?.activeVideoIntersectionRatio,
        recentlyPlayed: ctx?.activeVideoRecentlyPlayed,
      });
      if (
        shouldHideStickyOfferForLiveIdentity({
          offerContentIdentity: actionState.contentIdentity,
          liveContentIdentity: liveIdentity,
          liveOwnershipConfidence,
        })
      ) {
        return false;
      }
    } else {
      const gctx = generalPageMediaContextStore.get(tabId);
      const liveIdentity = gctx?.currentMediaIdentity ?? null;
      const liveOwnershipConfidence = resolveLivePresentationOwnership({
        canonicalContentId: liveIdentity,
        identityConfidence: gctx?.currentMediaIdentity ? 'MEDIUM' : null,
        intersectionRatio: gctx?.activeVideoIntersectionRatio ?? null,
        recentlyPlayed: gctx?.activeVideoRecentlyPlayed,
      });
      if (
        shouldHideStickyOfferForLiveIdentity({
          offerContentIdentity: actionState.contentIdentity,
          liveContentIdentity: liveIdentity,
          liveOwnershipConfidence,
        })
      ) {
        return false;
      }
    }
  }

  if (currentPageUrl) {
    try {
      const protocol = new URL(currentPageUrl).protocol.toLowerCase();
      if (protocol === 'vidorax:' || protocol === 'about:') {
        return false;
      }
    } catch {
      // ignore
    }
  }

  return true;
}

export function buildBrowserDownloadPresentation(
  input: BrowserDownloadPresentationInput,
): BrowserDownloadPresentation {
  const { actionState, activeTabId, hasDownloadableOptions } = input;
  const verifiedEligible = isBrowserDownloadCtaEligible(input);
  const shellState = resolveCtaShellPresentation({
    isHome: input.isHome,
    hasBrowserError: input.hasBrowserError,
    overlayBlocking: input.overlayBlocking,
    actionState,
    liveContentIdentity: input.liveContentIdentity ?? null,
    liveOwnershipConfidence: input.liveOwnershipConfidence ?? null,
    hasVerifiedOffer: verifiedEligible,
    liveIdentityConsumed: Boolean(input.liveIdentityConsumed),
  });
  const eligible =
    verifiedEligible ||
    shouldKeepCtaShellMounted({ shellState });
  const isPreparing = actionState.status === 'preparing';
  const isTracking = shellState === 'TRACKING_CURRENT_VIDEO';
  const isFailureHint =
    (Boolean(actionState.errorMessage) && !isPreparing && !actionState.selectionLocked) ||
    shellState === 'UNSUPPORTED_CURRENT_CONTENT';
  const media = actionState.media;
  const analysis = actionState.analysis;

  const title = sanitizeTitle(
    resolveDownloadPlatformTitle(analysis, actionState.pageUrl, media),
  );
  const format = formatDownloadFormatLabel(analysis, media);
  const sizeLabel = formatDownloadSizeLabel(resolveVerifiedSizeBytes(analysis));
  const qualityLabel = formatDownloadQualityLabel(analysis, media);
  const audioLabel = formatDownloadAudioLabel(analysis, media);
  const metaLine = buildMetadataLine([format, sizeLabel, qualityLabel]);
  const thumbnailUri = resolveSafeThumbnailUri(analysis, media);

  const buttonLabel = isPreparing ? 'Preparing download…' : 'Video available';

  const eyebrow = isPreparing
    ? 'Preparing download…'
    : isTracking
      ? 'Current video'
      : isFailureHint
        ? 'Couldn’t prepare this video'
        : 'Video available';

  const selectionLocked = Boolean(actionState.selectionLocked);
  const buttonDisabled =
    isPreparing ||
    selectionLocked ||
    (actionState.status === 'verified' && !hasDownloadableOptions);

  const accessibilityMeta = metaLine
    ? metaLine
        .replace(/•/g, ',')
        .replace(/\bMB\b/g, 'megabytes')
        .replace(/\bKB\b/g, 'kilobytes')
        .replace(/\bGB\b/g, 'gigabytes')
    : null;

  const showCard =
    eligible &&
    isActionableCtaShell(shellState) &&
    shellState !== 'CONSUMED_CURRENT_CONTENT';

  return {
    candidateId: media?.id ?? null,
    tabId: activeTabId,
    pageUrl: actionState.pageUrl,
    isEligible: eligible,
    showCard,
    shellState,
    eyebrow,
    title,
    format,
    sizeLabel,
    qualityLabel,
    audioLabel,
    metaLine,
    thumbnailUri,
    buttonLabel,
    buttonDisabled,
    isPreparing,
    isFailureHint,
    failureMessage: actionState.errorMessage,
    accessibilityEyebrow: isPreparing
      ? 'Preparing download'
      : isTracking
        ? 'Current video'
        : isFailureHint
          ? 'Could not prepare this video'
          : 'Video available',
    accessibilityTitle: title,
    accessibilityMeta,
    accessibilityButton: isPreparing
      ? 'Preparing download'
      : 'Video available. Opens Play or Download.',
  };
}
