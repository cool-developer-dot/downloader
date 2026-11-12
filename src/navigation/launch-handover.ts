/**
 * When the launch sequence has handed the screen to the app. The router already shows the Browser under the branded
 * splash, and the splash (or the first-launch pages) ends by replacing the top route — so anything that opens a screen
 * by itself (a file from another app) must wait for this, or it is replaced at once. Pure module state; no React.
 */

let splashShown = false;
let handedOver = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A listener must not break the launch.
    }
  });
}

/** The branded splash mounted: the launch now ends with its own navigation. */
export function markSplashShown(): void {
  if (splashShown) {
    return;
  }
  splashShown = true;
  emit();
}

/** The splash or the first-launch pages navigated to the app. */
export function markLaunchHandedOver(): void {
  if (handedOver) {
    return;
  }
  handedOver = true;
  emit();
}

export function isSplashShown(): boolean {
  return splashShown;
}

export function isLaunchHandedOver(): boolean {
  return handedOver;
}

export function subscribeLaunchHandover(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetLaunchHandoverForTests(): void {
  splashShown = false;
  handedOver = false;
  listeners.clear();
}
