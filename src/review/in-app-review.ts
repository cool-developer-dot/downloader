import { mmkvKeys } from '@/storage/constants';
import { getMmkvInstance } from '@/storage/mmkv/instance';

import {
  createReviewController,
  type ReviewCompletionSource,
  type ReviewRequestOutcome,
} from './review-controller';
import { parseReviewState, type CalmMomentInput, type ReviewState } from './review-policy';

function log(event: string, fields?: Record<string, unknown>): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log('[InAppReview]', { event, ...fields });
}

function load(): ReviewState {
  return parseReviewState(getMmkvInstance()?.getString(mmkvKeys.inAppReview));
}

function save(state: ReviewState): void {
  const mmkv = getMmkvInstance();
  if (!mmkv) {
    // No local storage (e.g. Expo Go): without a stored attempt the controller never asks, so it cannot repeat.
    throw new Error('Local storage is unavailable');
  }
  mmkv.set(mmkvKeys.inAppReview, JSON.stringify(state));
}

/**
 * Google Play In-App Review through expo-store-review (Play's `ReviewManager`: `requestReviewFlow` then
 * `launchReviewFlow`). Loaded lazily so a build without the native module simply reports "unavailable".
 * `isAvailableAsync` is true only when the Play Store is installed; the store-URL fallback in that library is never
 * reached because `requestReview` is only called after it.
 */
async function isAvailable(): Promise<boolean> {
  const StoreReview = await import('expo-store-review');
  return StoreReview.isAvailableAsync();
}

async function requestReview(): Promise<void> {
  const StoreReview = await import('expo-store-review');
  await StoreReview.requestReview();
}

const controller = createReviewController({ load, save, now: () => Date.now(), isAvailable, requestReview, log });

type Listener = () => void;
const completionListeners = new Set<Listener>();

/**
 * Counts the downloads the engine recorded as genuinely completed (COMPLETED with the verified library file) and not
 * counted yet — including those that finished while the app was closed — once each. Called by the v2 download bridge
 * at startup, when the app returns to the foreground and after each live completion; wakes the prompt host when
 * something was counted, so a user already sitting on Downloads or Player can be asked right after the success.
 * Best effort: a failure here never touches downloads.
 */
export async function reconcileReviewCompletions(source: ReviewCompletionSource): Promise<void> {
  let counted = 0;
  try {
    counted = await controller.reconcileCompletions(source);
  } catch {
    return;
  }
  if (counted === 0) {
    return;
  }
  for (const listener of completionListeners) {
    try {
      listener();
    } catch {
      // A listener never breaks the download bridge.
    }
  }
}

export function subscribeReviewCompletions(listener: Listener): () => void {
  completionListeners.add(listener);
  return () => {
    completionListeners.delete(listener);
  };
}

export function requestInAppReviewIfCalm(moment: CalmMomentInput): Promise<ReviewRequestOutcome> {
  return controller.maybeRequest(moment).then((outcome) => {
    if (outcome !== 'not_calm' && outcome !== 'busy') {
      log('review.evaluated', { outcome, route: moment.pathname });
    }
    return outcome;
  });
}
