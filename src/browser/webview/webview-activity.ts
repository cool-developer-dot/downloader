import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

/**
 * Which physical WebViews may run: only the active tab's, and only while the Browser route is in front.
 *
 * A parked tab keeps its WebView (history, scroll, form state) but is paused natively (`WebView.onPause()`): Chromium
 * then treats its page as hidden — no compositor frames, no rAF, throttled timers, suspended media — and the page's
 * detector suspends itself on `visibilitychange` (see the injected script). Before this, a parked Facebook tab kept
 * playing its video off-screen and forced the app to redraw every video frame.
 */

type Listener = () => void;

let browserRouteVisible = true;
const listeners = new Set<Listener>();

export function setBrowserRouteVisible(visible: boolean): void {
  if (browserRouteVisible === visible) {
    return;
  }
  browserRouteVisible = visible;
  for (const listener of listeners) {
    listener();
  }
}

export function isBrowserRouteVisible(): boolean {
  return browserRouteVisible;
}

export function subscribeBrowserRouteVisible(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Last state sent per view tag, so re-renders and re-binds never repeat the native call. */
const applied = new Map<number, boolean>();
const MAX_TRACKED_VIEWS = 8;

type ActivityDriver = (viewTag: number, active: boolean) => Promise<boolean>;
let driverForTests: ActivityDriver | null = null;

/** Tests stand in for the native module (which is never linked under Node). */
export function setWebViewActivityDriverForTests(driver: ActivityDriver | null): void {
  driverForTests = driver;
  applied.clear();
  browserRouteVisible = true;
  listeners.clear();
}

function resolveDriver(): ActivityDriver | null {
  if (driverForTests) {
    return driverForTests;
  }
  if (!isVidoraWebAvailable()) {
    return null;
  }
  const web = getVidoraWeb();
  // An installed build older than this JS has no such function; parking is then simply skipped.
  if (typeof web.setWebViewActive !== 'function') {
    return null;
  }
  return (viewTag, active) => web.setWebViewActive(viewTag, active);
}

export function applyNativeWebViewActivity(viewTag: number, active: boolean): void {
  if (applied.get(viewTag) === active) {
    return;
  }
  applied.delete(viewTag);
  applied.set(viewTag, active);
  while (applied.size > MAX_TRACKED_VIEWS) {
    applied.delete(applied.keys().next().value!);
  }
  const driver = resolveDriver();
  if (!driver) {
    return;
  }
  driver(viewTag, active).then(
    (found) => {
      if (!found && applied.get(viewTag) === active) {
        applied.delete(viewTag);
      }
    },
    () => {
      if (applied.get(viewTag) === active) {
        applied.delete(viewTag);
      }
    },
  );
}

/** The WebView behind this tag is gone; a new one may reuse nothing of it. */
export function forgetNativeWebViewActivity(viewTag: number): void {
  applied.delete(viewTag);
}
