import { BackHandler, type NativeEventSubscription } from 'react-native';

/**
 * Single deterministic Android Back chain.
 *
 * React Native invokes `hardwareBackPress` subscribers in reverse registration
 * order, so two owners that are added in different orders on different paths
 * (first focus vs. re-render after a tab switch) silently swap priority. The
 * Browser screen and the tab-exit guard both want Back, which made Back
 * non-deterministic: sometimes the page navigated, sometimes the exit toast ate
 * the press and the Browser looked stuck.
 *
 * All owners now register here instead. Exactly one RN subscription exists, and
 * owners are consulted by explicit priority (highest first) regardless of when
 * they registered. The first owner returning true consumes the press.
 */

export const BACK_PRIORITY = {
  /** Launch gates (splash / onboarding) — swallow Back entirely. */
  gate: 30,
  /** Focused screen content — in-page Back (e.g. Browser history). */
  screen: 20,
  /** Last resort: double-press-to-exit on the landing tab. */
  appExit: 0,
} as const;

type BackOwner = {
  id: number;
  priority: number;
  handler: () => boolean;
};

const owners: BackOwner[] = [];
let subscription: NativeEventSubscription | null = null;
let nextOwnerId = 1;

function dispatchBackPress(): boolean {
  // Snapshot: an owner may unregister itself while handling the press.
  const ordered = [...owners].sort((a, b) => b.priority - a.priority || b.id - a.id);
  for (const owner of ordered) {
    if (owner.handler()) {
      return true;
    }
  }
  return false;
}

function ensureSubscribed(): void {
  if (subscription) {
    return;
  }
  subscription = BackHandler.addEventListener('hardwareBackPress', dispatchBackPress);
}

function releaseWhenIdle(): void {
  if (owners.length > 0 || !subscription) {
    return;
  }
  subscription.remove();
  subscription = null;
}

/** Register a Back owner. Returns an idempotent unregister. */
export function registerBackOwner(
  priority: number,
  handler: () => boolean,
): () => void {
  const owner: BackOwner = { id: nextOwnerId++, priority, handler };
  owners.push(owner);
  ensureSubscribed();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const index = owners.indexOf(owner);
    if (index >= 0) {
      owners.splice(index, 1);
    }
    releaseWhenIdle();
  };
}

/** Test/reset helper — drops every owner and the RN subscription. */
export function __resetBackOwnersForTests(): void {
  owners.length = 0;
  subscription?.remove();
  subscription = null;
}

/** Test helper — drive the chain without a native event. */
export function __dispatchBackPressForTests(): boolean {
  return dispatchBackPress();
}
