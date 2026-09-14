/**
 * Local source freshness heuristics for resume/retry — no backend.
 */

import {
  assessExpiringMediaUrl,
  isLikelyExpiredMediaUrl,
} from '@/media-detection/services/expiring-url.service';

import { getDownloadSessionMeta } from './download-session-meta';
import { isSocialCdnUrl } from './source-capability';
import type { LocalDownloadRecord } from './types';

/** Stale if no explicit expiry but session is old (mobile CDN URLs). */
const SOCIAL_URL_AGE_STALE_MS = 30 * 60 * 1000;

export type SourceFreshnessAssessment = {
  likelyStale: boolean;
  reason: 'expired_param' | 'signed_heuristic' | 'session_age' | 'fresh' | null;
};

export function assessSourceFreshness(
  record: LocalDownloadRecord,
  nowMs = Date.now(),
): SourceFreshnessAssessment {
  if (isLikelyExpiredMediaUrl(record.sourceUrl, nowMs)) {
    return { likelyStale: true, reason: 'expired_param' };
  }

  const expiry = assessExpiringMediaUrl(record.sourceUrl, nowMs);
  if (expiry.isExpired) {
    return { likelyStale: true, reason: 'expired_param' };
  }

  const meta = getDownloadSessionMeta(record.downloadId);
  if (isSocialCdnUrl(record.sourceUrl) && meta?.pageUrl) {
    const age = nowMs - (meta.detectedAt ?? 0);
    if (expiry.likelyExpiring && age > SOCIAL_URL_AGE_STALE_MS) {
      return { likelyStale: true, reason: 'signed_heuristic' };
    }
    if (age > SOCIAL_URL_AGE_STALE_MS * 2) {
      return { likelyStale: true, reason: 'session_age' };
    }
  }

  return { likelyStale: false, reason: 'fresh' };
}

export function shouldRefreshSourceOnResume(record: LocalDownloadRecord): boolean {
  const assessment = assessSourceFreshness(record);
  const meta = getDownloadSessionMeta(record.downloadId);
  if (!meta?.pageUrl) {
    return false;
  }
  return assessment.likelyStale;
}
