import type { MediaAnalysisResult } from '@/api/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import type { DetectedMedia } from '@/media-detection/types';

/**
 * Canonical Browser Download CTA lifecycle (Phase 3F).
 * Maps onto internal BrowserMediaActionStatus without forcing a rename.
 *
 * NONE                 ← idle | detecting | (invalid/stale)
 * AVAILABLE            ← verified | failed(with offer restored)
 * HANDOFF_IN_PROGRESS  ← preparing
 * CONSUMED             ← consumed | downloading | completed (legacy)
 */
export type BrowserMediaCtaState =
  | 'NONE'
  | 'AVAILABLE'
  | 'HANDOFF_IN_PROGRESS'
  | 'CONSUMED';

/**
 * Internal service statuses. Prefer toBrowserMediaCtaState() for product logic.
 * `downloading` / `completed` are legacy — treat as CONSUMED; do not drive CTA from Phase 1 transfer.
 */
export type BrowserMediaActionStatus =
  | 'idle'
  | 'detecting'
  | 'verified'
  | 'preparing'
  | 'downloading'
  | 'completed'
  | 'consumed'
  | 'failed';

export type BrowserMediaActionState = {
  status: BrowserMediaActionStatus;
  pageUrl: string | null;
  media: DetectedMedia | null;
  analysis: MediaAnalysisResult | null;
  requestContext: MediaRequestContext | null;
  mediaUrl: string | null;
  mediaFingerprint: string | null;
  /**
   * Phase 4A content identity (platform:type:id). Used so signed-URL CDN path
   * changes cannot resurrect a consumed CTA for the same Reel/video.
   */
  contentIdentity: string | null;
  /** Phase 4B preferred/selected variant resource identity. */
  variantIdentity: string | null;
  errorMessage: string | null;
  /** Pending paste session auto-expanded the bar once. */
  autoShownOnce: boolean;
  /** User dismissed the expanded bar — compact CTA remains. */
  dismissed: boolean;
  /** Quality sheet open for this offer — blocks duplicate sheets, not yet handoff. */
  selectionLocked: boolean;
  /** Optional Phase 1 id after successful enqueue (diagnostics only). */
  downloadId: string | null;
  /** @deprecated Unused — transfer progress belongs to Downloads screen. */
  downloadProgress: number | null;
};

export type BrowserMediaVerifiedHandoff = {
  pageUrl: string;
  media: DetectedMedia;
  analysis: MediaAnalysisResult;
  requestContext: MediaRequestContext;
  mediaUrl: string;
  autoShow?: boolean;
  contentIdentity?: string | null;
  variantIdentity?: string | null;
};

export type BrowserMediaHandoffClaim =
  | {
      outcome: 'CLAIMED';
      handoffGeneration: number;
      tabId: string;
      fingerprint: string;
      analysis: MediaAnalysisResult;
      requestContext: MediaRequestContext;
      mediaUrl: string | null;
      pageUrl: string | null;
      contentIdentity: string | null;
      variantIdentity: string | null;
    }
  | { outcome: 'ALREADY_IN_PROGRESS' }
  | { outcome: 'ALREADY_CONSUMED' }
  | { outcome: 'SELECTION_LOCKED' }
  | { outcome: 'STALE' }
  | { outcome: 'NOT_AVAILABLE' };

export type BrowserMediaQualityFreeze = {
  fingerprint: string;
  contentIdentity: string | null;
  variantIdentity: string | null;
  pageUrl: string | null;
  navigationEpoch: number;
  /** Phase 5A general pageGeneration — null when social owns the page. */
  pageGeneration: number | null;
  /** Phase 4A social contextGeneration — null when general owns the page. */
  socialContextGeneration: number | null;
};

export type BrowserMediaSelectionClaim =
  | {
      outcome: 'LOCKED';
      selectionGeneration: number;
      tabId: string;
      fingerprint: string;
      freeze: BrowserMediaQualityFreeze;
    }
  | { outcome: 'ALREADY_LOCKED' }
  | { outcome: 'ALREADY_IN_PROGRESS' }
  | { outcome: 'ALREADY_CONSUMED' }
  | { outcome: 'NOT_AVAILABLE' };

export const initialBrowserMediaActionState: BrowserMediaActionState = {
  status: 'idle',
  pageUrl: null,
  media: null,
  analysis: null,
  requestContext: null,
  mediaUrl: null,
  mediaFingerprint: null,
  contentIdentity: null,
  variantIdentity: null,
  errorMessage: null,
  autoShownOnce: false,
  dismissed: false,
  selectionLocked: false,
  downloadId: null,
  downloadProgress: null,
};

export function toBrowserMediaCtaState(
  status: BrowserMediaActionStatus,
): BrowserMediaCtaState {
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
    case 'idle':
    case 'detecting':
    default:
      return 'NONE';
  }
}
