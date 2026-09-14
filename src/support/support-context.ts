/**
 * Phase 4B.2 — Contextual support routing.
 *
 * SupportContext carries ONLY semantic, frozen IDs — never:
 *   - raw exceptions or error objects
 *   - source / media URLs
 *   - local filesystem paths
 *   - tokens / credentials
 *   - internal / backend identifiers
 *
 * All values are validated against frozen lists before use.
 * Invalid values are silently ignored — context is best-effort.
 *
 * NODE-SAFE: This file must NOT import react-native or @/navigation.
 * Navigation helpers live in support-navigation.ts (React-only, not exported from index).
 */

import { SUPPORT_CATEGORY_IDS } from './categories';
import type { SupportCategoryId } from './types';
import { SUPPORT_FAQ_IDS } from './faq-content';
import { REPORT_CATEGORY_IDS, type ReportCategoryId } from './report-types';

/**
 * Contextual hint passed to the Support/Report screens.
 * All fields are optional — only frozen, safe semantic values are allowed.
 */
export type SupportContext = {
  /** Pre-select this help category. Must be a frozen SupportCategoryId. */
  categoryId?: SupportCategoryId;
  /** Pre-expand this FAQ item. Must be a frozen FAQ id string. */
  faqId?: string;
  /** Pre-select this report category in the Report form. */
  reportCategory?: ReportCategoryId;
  /**
   * Human-readable semantic label describing the error context.
   * Used as optional report subject prefix. Max 80 chars.
   * MUST NOT contain URLs, tokens, paths, or technical stack details.
   */
  source?: string;
};

/** Route param names — frozen. Do not rename. */
export const SUPPORT_CONTEXT_PARAMS = {
  categoryId: 'categoryId',
  faqId: 'faqId',
  reportCategory: 'reportCategory',
  source: 'source',
} as const;

const SOURCE_MAX_LENGTH = 80;

/**
 * Validates a raw categoryId param string against frozen list.
 * Returns undefined if invalid.
 */
export function validateContextCategoryId(
  value: string | undefined,
): SupportCategoryId | undefined {
  if (!value) {
    return undefined;
  }
  return (SUPPORT_CATEGORY_IDS as readonly string[]).includes(value)
    ? (value as SupportCategoryId)
    : undefined;
}

/**
 * Validates a raw faqId param string against frozen list.
 * Returns undefined if invalid.
 */
export function validateContextFaqId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return (SUPPORT_FAQ_IDS as readonly string[]).includes(value) ? value : undefined;
}

/**
 * Validates a raw reportCategory param string against frozen list.
 * Returns undefined if invalid.
 */
export function validateContextReportCategory(
  value: string | undefined,
): ReportCategoryId | undefined {
  if (!value) {
    return undefined;
  }
  return (REPORT_CATEGORY_IDS as readonly string[]).includes(value)
    ? (value as ReportCategoryId)
    : undefined;
}

/**
 * Validates and sanitises a source label.
 * Strips leading/trailing whitespace, clamps to max length.
 * Returns undefined if empty after trimming.
 */
export function validateContextSource(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().slice(0, SOURCE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses and validates all context params from raw query params.
 * Returns a clean SupportContext — ignores any unrecognised or invalid fields.
 */
export function parseSupportContextParams(
  params: Partial<Record<string, string | string[]>>,
): SupportContext {
  const raw = (key: string): string | undefined => {
    const v = params[key];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
  };

  return {
    categoryId: validateContextCategoryId(raw(SUPPORT_CONTEXT_PARAMS.categoryId)),
    faqId: validateContextFaqId(raw(SUPPORT_CONTEXT_PARAMS.faqId)),
    reportCategory: validateContextReportCategory(raw(SUPPORT_CONTEXT_PARAMS.reportCategory)),
    source: validateContextSource(raw(SUPPORT_CONTEXT_PARAMS.source)),
  };
}

/**
 * Returns true if the context carries any useful content.
 */
export function hasSupportContext(ctx: SupportContext): boolean {
  return !!(ctx.categoryId || ctx.faqId || ctx.reportCategory || ctx.source);
}

// ─── Approved Get Help contexts (frozen, security-reviewed) ─────────────────

/**
 * Player error → contextual support mapping.
 * Maps PlayerErrorCode values to safe SupportContext.
 * No raw error data is passed through.
 */
export const PLAYER_ERROR_SUPPORT_CONTEXT: Record<string, SupportContext> = {
  UNSUPPORTED_MEDIA: {
    categoryId: 'playback',
    faqId: 'unsupported-codec',
    reportCategory: 'playback',
    source: 'Unsupported media format',
  },
  CORRUPT_MEDIA: {
    categoryId: 'playback',
    faqId: 'video-not-playing',
    reportCategory: 'playback',
    source: 'Unreadable video file',
  },
  FILE_UNAVAILABLE: {
    categoryId: 'library-files',
    faqId: 'file-unavailable',
    reportCategory: 'file',
    source: 'File unavailable',
  },
  MEDIA_NOT_FOUND: {
    categoryId: 'library-files',
    faqId: 'file-unavailable',
    reportCategory: 'file',
    source: 'Media not found',
  },
  SOURCE_RESOLUTION_FAILED: {
    categoryId: 'playback',
    faqId: 'video-not-playing',
    reportCategory: 'playback',
    source: 'Unable to prepare video',
  },
  PLAYBACK_FAILED: {
    categoryId: 'playback',
    faqId: 'video-not-playing',
    reportCategory: 'playback',
    source: 'Playback error',
  },
  PLAYER_INIT_FAILED: {
    categoryId: 'playback',
    faqId: 'video-not-playing',
    reportCategory: 'playback',
    source: 'Player initialisation error',
  },
  PREPARATION_TIMEOUT: {
    categoryId: 'playback',
    faqId: 'video-not-playing',
    reportCategory: 'playback',
    source: 'Video preparation timed out',
  },
  PERMISSION_DENIED: {
    categoryId: 'account-settings',
    faqId: 'storage-settings',
    reportCategory: 'file',
    source: 'Permission denied',
  },
} as const;

/**
 * Download error code → contextual support mapping.
 * Maps DownloadEngineErrorCode strings to safe SupportContext.
 * Only codes where help genuinely improves UX are listed.
 */
export const DOWNLOAD_ERROR_SUPPORT_CONTEXT: Record<string, SupportContext> = {
  UNSUPPORTED_DRM: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'DRM-protected source',
  },
  HLS_UNSUPPORTED: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'Unsupported HLS stream',
  },
  HLS_ENCRYPTED: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'Encrypted HLS stream',
  },
  UNSUPPORTED_HLS_ENCRYPTION: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'Unsupported HLS encryption',
  },
  LIVE_HLS_UNSUPPORTED: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'Live stream (not downloadable)',
  },
  INVALID_RESOURCE: {
    categoryId: 'downloads',
    faqId: 'unsupported-source',
    reportCategory: 'download',
    source: 'Invalid download source',
  },
  INSUFFICIENT_STORAGE: {
    categoryId: 'account-settings',
    faqId: 'storage-settings',
    reportCategory: 'download',
    source: 'Insufficient storage',
  },
  FILE_SYSTEM_ERROR: {
    categoryId: 'account-settings',
    faqId: 'storage-settings',
    reportCategory: 'download',
    source: 'File system error',
  },
  PERMISSION_DENIED: {
    categoryId: 'account-settings',
    faqId: 'storage-settings',
    reportCategory: 'download',
    source: 'Storage permission denied',
  },
  RETRY_EXHAUSTED: {
    categoryId: 'downloads',
    faqId: 'download-failed',
    reportCategory: 'download',
    source: 'Download failed after retries',
  },
} as const;

/**
 * Default download failure context when the specific error code is not mapped.
 */
export const DOWNLOAD_DEFAULT_SUPPORT_CONTEXT: SupportContext = {
  categoryId: 'downloads',
  faqId: 'download-failed',
  reportCategory: 'download',
  source: 'Download failure',
};

/**
 * File unavailable context (completed download, missing local file).
 */
export const FILE_UNAVAILABLE_SUPPORT_CONTEXT: SupportContext = {
  categoryId: 'library-files',
  faqId: 'file-unavailable',
  reportCategory: 'file',
  source: 'File unavailable',
};

/**
 * Returns the support context for a given download error code.
 * Falls back to default context for unmapped codes.
 */
export function getDownloadSupportContext(errorCode: string | null): SupportContext {
  if (!errorCode) {
    return DOWNLOAD_DEFAULT_SUPPORT_CONTEXT;
  }
  return DOWNLOAD_ERROR_SUPPORT_CONTEXT[errorCode] ?? DOWNLOAD_DEFAULT_SUPPORT_CONTEXT;
}

/**
 * Returns the support context for a given player error code.
 * Falls back to a generic playback context.
 */
export function getPlayerSupportContext(errorCode: string | null): SupportContext {
  if (!errorCode) {
    return PLAYER_ERROR_SUPPORT_CONTEXT.PLAYBACK_FAILED;
  }
  return (
    PLAYER_ERROR_SUPPORT_CONTEXT[errorCode] ??
    PLAYER_ERROR_SUPPORT_CONTEXT.PLAYBACK_FAILED
  );
}
