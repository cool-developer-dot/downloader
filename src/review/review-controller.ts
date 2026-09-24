import {
  isCalmMoment,
  recordReviewRequested,
  recordSuccessfulDownload,
  reviewEligibility,
  type CalmMomentInput,
  type ReviewState,
} from './review-policy';

export type ReviewRequestOutcome =
  /** Play was asked. Whether a sheet appeared, or a review was left, is Google's and the user's business. */
  | 'requested'
  | 'not_calm'
  | 'ineligible'
  /** No Play Store on this device (or no native module): nothing to ask. */
  | 'unavailable'
  /** The Play call failed; the attempt still counts, so it is not retried before next week. */
  | 'failed'
  | 'busy';

export type ReviewControllerDeps = {
  load: () => ReviewState;
  save: (state: ReviewState) => void;
  now: () => number;
  /** Whether the Play in-app review API can be used here (Play Store present). */
  isAvailable: () => Promise<boolean>;
  /** The official Play In-App Review flow (`requestReviewFlow` + `launchReviewFlow`). */
  requestReview: () => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

/** Where genuine completions come from: the download engine's completion outbox (VidoraMedia). */
export type ReviewCompletionSource = {
  listCompletedDownloads(): Promise<{ id: string; completedAt: number }[]>;
  acknowledgeCompletedDownloads(ids: string[]): Promise<void>;
};

export type ReviewController = {
  /** A download reached COMPLETED with its verified library file. Counted once per id. */
  onDownloadCompleted: (downloadId: string) => void;
  /**
   * Counts the completions the engine recorded — also those that happened while no JavaScript ran — once each, then
   * acknowledges them to the engine. Acknowledged only after the counts are saved, so a crash in between re-reads
   * them and the remembered ids stop a second count. Resolves with how many were newly counted; never throws.
   */
  reconcileCompletions: (source: ReviewCompletionSource) => Promise<number>;
  /** Asks Play for the review sheet when this is a calm moment and the local rules allow it. Never throws. */
  maybeRequest: (moment: CalmMomentInput) => Promise<ReviewRequestOutcome>;
};

/**
 * Everything here is best effort and isolated: a storage or Play failure is swallowed, so nothing about the review
 * prompt can ever affect a download, the library or the player.
 */
export function createReviewController(deps: ReviewControllerDeps): ReviewController {
  const log = deps.log ?? (() => undefined);
  let requesting = false;

  function safeLoad(): ReviewState | null {
    try {
      return deps.load();
    } catch {
      return null;
    }
  }

  function safeSave(state: ReviewState): boolean {
    try {
      deps.save(state);
      return true;
    } catch {
      return false;
    }
  }

  let reconciling: Promise<number> = Promise.resolve(0);

  async function reconcileOnce(source: ReviewCompletionSource): Promise<number> {
    let completions: { id: string; completedAt: number }[];
    try {
      completions = await source.listCompletedDownloads();
    } catch {
      return 0;
    }
    if (completions.length === 0) {
      return 0;
    }
    const state = safeLoad();
    if (!state) {
      return 0;
    }
    let next = state;
    for (const completion of [...completions].sort((a, b) => a.completedAt - b.completedAt)) {
      next = recordSuccessfulDownload(next, completion.id, completion.completedAt);
    }
    const counted = next.successfulDownloadCount - state.successfulDownloadCount;
    if (next !== state && !safeSave(next)) {
      // Not saved means not counted: leave them in the engine's outbox for the next attempt.
      return 0;
    }
    if (counted > 0) {
      log('review.download_counted', { count: next.successfulDownloadCount, reconciled: counted });
    }
    try {
      await source.acknowledgeCompletedDownloads(completions.map((completion) => completion.id));
    } catch {
      // Re-read next time; the remembered ids keep them from counting twice.
    }
    return counted;
  }

  return {
    reconcileCompletions(source) {
      // One at a time: startup, foreground and a live completion can all ask at once.
      reconciling = reconciling.then(
        () => reconcileOnce(source),
        () => reconcileOnce(source),
      );
      return reconciling;
    },

    onDownloadCompleted(downloadId) {
      const state = safeLoad();
      if (!state) {
        return;
      }
      const next = recordSuccessfulDownload(state, downloadId, deps.now());
      if (next !== state) {
        safeSave(next);
        log('review.download_counted', { count: next.successfulDownloadCount });
      }
    },

    async maybeRequest(moment) {
      if (requesting) {
        return 'busy';
      }
      if (!isCalmMoment(moment)) {
        return 'not_calm';
      }
      const state = safeLoad();
      if (!state) {
        return 'ineligible';
      }
      const eligibility = reviewEligibility(state, deps.now());
      if (!eligibility.eligible) {
        return 'ineligible';
      }
      requesting = true;
      try {
        let available = false;
        try {
          available = await deps.isAvailable();
        } catch {
          available = false;
        }
        if (!available) {
          log('review.unavailable');
          return 'unavailable';
        }
        // Recorded first: whatever Play does next, the next request waits for the weekly rule. Without a stored
        // attempt there is no request, so repeated prompting is impossible even if saving fails.
        if (!safeSave(recordReviewRequested(state, deps.now()))) {
          return 'failed';
        }
        log('review.requested', { downloads: state.successfulDownloadCount, previous: state.requestCount });
        try {
          await deps.requestReview();
          return 'requested';
        } catch (error) {
          log('review.failed', { message: error instanceof Error ? error.message.slice(0, 120) : null });
          return 'failed';
        }
      } finally {
        requesting = false;
      }
    },
  };
}
