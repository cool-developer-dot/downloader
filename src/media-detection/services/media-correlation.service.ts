import type { DetectedMedia } from '../types';
import { describePlatformPage } from '../platform';
import {
  isLikelySocialProfileAsset,
  isLikelySocialThumbnail,
  matchesPlatformCdn,
} from '../platform/cdn-hosts';
import { assessExpiringMediaUrl } from './expiring-url.service';
import { logMediaDiagnostic } from './media-diagnostics.service';

export type MediaCorrelationContext = {
  pageUrl: string | null;
  /** True when blob/MSE playback was recently observed on this page. */
  msePlaybackActive?: boolean;
  msePlaybackAgeMs?: number | null;
};

export type MediaCorrelationResult = {
  score: number;
  reasons: string[];
  reject: boolean;
  rejectionReason: string | null;
};

const MIN_DISPLAY_SCORE = 0.42;

/**
 * Scores how likely a candidate is the primary playable video for the current page.
 */
export function scoreMediaCorrelation(
  media: DetectedMedia,
  context: MediaCorrelationContext,
): MediaCorrelationResult {
  const reasons: string[] = [];
  let score = media.confidence;

  const pageUrl = context.pageUrl ?? media.pageUrl;
  const platform = pageUrl ? describePlatformPage(pageUrl) : null;
  const platformKind = platform?.kind ?? 'generic';

  if (media.category !== 'video' && media.category !== 'stream') {
    return reject(score, 'not_video', 'non_video_candidate');
  }

  if (media.url.startsWith('blob:')) {
    return reject(score, 'blob_url', 'blob_not_downloadable');
  }

  if (media.mimeType?.startsWith('image/')) {
    return reject(score, 'image_mime', 'image_not_video');
  }

  if (isLikelySocialThumbnail(media.url)) {
    score -= 0.35;
    reasons.push('thumbnail_penalty');
  }

  if (isLikelySocialProfileAsset(media.url)) {
    score -= 0.45;
    reasons.push('avatar_penalty');
  }

  if (platform && matchesPlatformCdn(media.url, platformKind)) {
    score += 0.18;
    reasons.push('platform_cdn_match');
  }

  if (platform?.isPublicContentPath) {
    score += 0.06;
    reasons.push('public_content_path');
  }

  if (
    media.detectionSource === 'native_network' ||
    media.detectionSource === 'js_fetch' ||
    media.detectionSource === 'js_xhr'
  ) {
    score += 0.08;
    reasons.push('network_observed');
  }

  if (media.mimeType?.startsWith('video/')) {
    score += 0.12;
    reasons.push('video_mime');
  }

  if (media.width != null && media.height != null && media.width >= 360) {
    score += 0.06;
    reasons.push('meaningful_dimensions');
  }

  if (media.estimatedFileSize != null && media.estimatedFileSize > 200_000) {
    score += 0.05;
    reasons.push('meaningful_size');
  }

  if (context.msePlaybackActive) {
    score += 0.14;
    reasons.push('mse_window_boost');
    if (context.msePlaybackAgeMs != null && context.msePlaybackAgeMs < 8_000) {
      score += 0.08;
      reasons.push('fresh_mse_window');
    }
  }

  if (media.requiresCookies) {
    score += 0.04;
    reasons.push('session_bound');
  }

  const expiry = assessExpiringMediaUrl(media.url);
  if (expiry.likelyExpiring) {
    reasons.push('signed_url');
    if (expiry.isExpired) {
      return reject(score, 'expired_signed_url', 'expired_candidate');
    }
  }

  if (media.videoOnly && media.hasSeparateAudio) {
    return reject(score, 'video_only_adaptive', 'silent_video_adaptive');
  }

  const normalized = Math.min(Math.max(score, 0), 1.5);
  const rejectCandidate = normalized < MIN_DISPLAY_SCORE;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    logMediaDiagnostic('media_candidate', {
      hostname: safeHostname(media.url),
      platform: platformKind,
      source: media.detectionSource,
      streamType: media.streamType,
      mimeType: media.mimeType,
      correlationScore: Number(normalized.toFixed(3)),
      reject: rejectCandidate,
      hasReferer: Boolean(media.requiredHeaders?.referer),
      hasCookies: Boolean(media.requiresCookies),
      isSignedUrl: expiry.likelyExpiring,
      separateAudio: media.hasSeparateAudio,
      videoOnly: media.videoOnly,
    });
  }

  return {
    score: normalized,
    reasons,
    reject: rejectCandidate,
    rejectionReason: rejectCandidate ? 'low_correlation' : null,
  };
}

export function pickBestCorrelatedMedia(
  candidates: DetectedMedia[],
  context: MediaCorrelationContext,
): DetectedMedia | null {
  let best: DetectedMedia | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const result = scoreMediaCorrelation(candidate, context);
    if (result.reject) {
      continue;
    }
    if (result.score > bestScore) {
      bestScore = result.score;
      best = candidate;
    }
  }

  return best;
}

export function filterCorrelatedCandidates(
  candidates: DetectedMedia[],
  context: MediaCorrelationContext,
): DetectedMedia[] {
  return candidates.filter((candidate) => {
    const result = scoreMediaCorrelation(candidate, context);
    return !result.reject;
  });
}

function reject(
  score: number,
  reason: string,
  rejectionReason: string,
): MediaCorrelationResult {
  return {
    score,
    reasons: [reason],
    reject: true,
    rejectionReason,
  };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export { MIN_DISPLAY_SCORE };
