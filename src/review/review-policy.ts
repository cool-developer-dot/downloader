/**
 * When VidoraX may ask Google Play for its in-app review sheet. Pure and local: the only inputs are this device's
 * own counts and times, never a server, and nothing here knows (or pretends to know) whether a review was left —
 * the Play API does not say, and Google alone decides whether the sheet appears at all.
 *
 * - The first request comes after the third genuine successful download.
 * - After that, at most once a week, and only after at least one new successful download since the last request.
 * - Always right after success: the latest successful download must be recent.
 * - Always at a calm moment: the app is in front and unlocked, nothing is downloading, the player is closed, and
 *   the user has settled on the Downloads or Player list (see [isCalmMoment]).
 *
 * There is no "Do you like VidoraX?" question first and no redirect for happy users only: every eligible user gets
 * the same official request.
 */

export const REVIEW_FIRST_REQUEST_DOWNLOADS = 3;
export const REVIEW_REPEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEW_REPEAT_MIN_NEW_DOWNLOADS = 1;
/** The request belongs to a success the user has just had, not to one from last month. */
export const REVIEW_RECENT_SUCCESS_MS = 24 * 60 * 60 * 1000;
/** How long the user has to stay on a calm screen before the request, so it never interrupts navigation. */
export const REVIEW_ROUTE_SETTLE_MS = 2_500;
/**
 * Completed download ids remembered to count each download once. The engine's completion outbox is acknowledged right
 * after each count is saved, so an id only needs to be remembered until then; the margin covers an acknowledgement
 * that failed and is retried at the next start.
 */
export const REVIEW_COUNTED_IDS_MAX = 200;

export type ReviewState = {
  version: 1;
  /** Genuine successful downloads: COMPLETED with a verified library file. */
  successfulDownloadCount: number;
  /** The most recent counted ids (bounded), so a replayed completion is never counted twice. */
  countedIds: string[];
  lastSuccessAt: number | null;
  /** When VidoraX last asked Play for the sheet — whatever Play then did. */
  lastReviewRequestAt: number | null;
  /** [successfulDownloadCount] at that request, to require new successful usage before the next one. */
  downloadsAtLastRequest: number;
  requestCount: number;
};

export const INITIAL_REVIEW_STATE: ReviewState = {
  version: 1,
  successfulDownloadCount: 0,
  countedIds: [],
  lastSuccessAt: null,
  lastReviewRequestAt: null,
  downloadsAtLastRequest: 0,
  requestCount: 0,
};

/**
 * Counts one genuinely completed download, once per id. `completedAt` is when it completed — for a download that
 * finished while the app was closed that is earlier than now, and "a recent success" must mean the real one.
 */
export function recordSuccessfulDownload(state: ReviewState, downloadId: string, completedAt: number): ReviewState {
  const id = downloadId.trim();
  if (!id || state.countedIds.includes(id)) {
    return state;
  }
  return {
    ...state,
    successfulDownloadCount: state.successfulDownloadCount + 1,
    countedIds: [...state.countedIds, id].slice(-REVIEW_COUNTED_IDS_MAX),
    lastSuccessAt: Math.max(state.lastSuccessAt ?? 0, completedAt),
  };
}

export type ReviewIneligibleReason =
  | 'not_enough_downloads'
  | 'no_recent_success'
  | 'too_soon'
  | 'no_new_success';

export type ReviewEligibility = { eligible: true } | { eligible: false; reason: ReviewIneligibleReason };

export function reviewEligibility(state: ReviewState, now: number): ReviewEligibility {
  if (state.successfulDownloadCount < REVIEW_FIRST_REQUEST_DOWNLOADS) {
    return { eligible: false, reason: 'not_enough_downloads' };
  }
  if (state.lastSuccessAt == null || now - state.lastSuccessAt > REVIEW_RECENT_SUCCESS_MS || now < state.lastSuccessAt) {
    return { eligible: false, reason: 'no_recent_success' };
  }
  if (state.lastReviewRequestAt != null) {
    // A clock set backwards counts as "too soon" rather than as permission to ask again.
    if (now - state.lastReviewRequestAt < REVIEW_REPEAT_INTERVAL_MS) {
      return { eligible: false, reason: 'too_soon' };
    }
    if (state.successfulDownloadCount - state.downloadsAtLastRequest < REVIEW_REPEAT_MIN_NEW_DOWNLOADS) {
      return { eligible: false, reason: 'no_new_success' };
    }
  }
  return { eligible: true };
}

/** Records an attempt. It is recorded before the request is made, so a failure can never cause a quick repeat. */
export function recordReviewRequested(state: ReviewState, now: number): ReviewState {
  return {
    ...state,
    lastReviewRequestAt: now,
    downloadsAtLastRequest: state.successfulDownloadCount,
    requestCount: state.requestCount + 1,
  };
}

export type CalmMomentInput = {
  appActive: boolean;
  appLocked: boolean;
  /** Downloads queued, preparing, transferring, waiting or finishing up. */
  inFlightDownloads: number;
  /** The current route, e.g. `/downloads`, `/library`, `/player/<id>`. */
  pathname: string;
  /** How long the current route has been showing. */
  routeStableMs: number;
};

/** The lists where the user looks at what they downloaded: Downloads and Player (the library). */
const CALM_ROUTES = new Set(['/downloads', '/library']);

export function isCalmRoute(pathname: string): boolean {
  const path = pathname.split('?')[0]?.replace(/\/+$/, '') ?? '';
  return CALM_ROUTES.has(path);
}

export function isCalmMoment(input: CalmMomentInput): boolean {
  return (
    input.appActive &&
    !input.appLocked &&
    input.inFlightDownloads === 0 &&
    isCalmRoute(input.pathname) &&
    input.routeStableMs >= REVIEW_ROUTE_SETTLE_MS
  );
}

/** Reads a persisted state defensively: anything malformed starts over rather than crashing or over-asking. */
export function parseReviewState(raw: string | null | undefined): ReviewState {
  if (!raw) {
    return INITIAL_REVIEW_STATE;
  }
  try {
    const value = JSON.parse(raw) as Partial<ReviewState> | null;
    if (!value || typeof value !== 'object' || value.version !== 1) {
      return INITIAL_REVIEW_STATE;
    }
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
    const time = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);
    return {
      version: 1,
      successfulDownloadCount: count(value.successfulDownloadCount),
      countedIds: Array.isArray(value.countedIds)
        ? value.countedIds.filter((id): id is string => typeof id === 'string').slice(-REVIEW_COUNTED_IDS_MAX)
        : [],
      lastSuccessAt: time(value.lastSuccessAt),
      lastReviewRequestAt: time(value.lastReviewRequestAt),
      downloadsAtLastRequest: count(value.downloadsAtLastRequest),
      requestCount: count(value.requestCount),
    };
  } catch {
    return INITIAL_REVIEW_STATE;
  }
}
