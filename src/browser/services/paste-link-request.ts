/**
 * "Paste link" from outside the app — the app shortcut (#515) and H22's widget, both `vidorax://paste-link` — runs the
 * in-app Paste link button's own action (`useQualitySelection().open`), whatever that action is: on main it opens the
 * Browser; with Faran's F7 it is his clipboard flow (the copied link opens like one pasted into the address bar,
 * YouTube refused, no link → the address bar focused). H7 never reads the clipboard for Paste link itself, so the
 * user gets exactly one Paste link behaviour and one prompt.
 *
 * The route only leaves a request; `PasteLinkRequestHandler` (inside the tabs, where the button's action lives)
 * runs it once the app is in front. Pure, so it is tested.
 */

let pending = false;
const listeners = new Set<() => void>();

/** Asks for the Paste link action to run once (a second request before it ran is the same one). */
export function requestPasteLink(): void {
  pending = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener must never stop the request.
    }
  }
}

export function hasPasteLinkRequest(): boolean {
  return pending;
}

/** True once per request: the caller runs the action. */
export function takePasteLinkRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function subscribePasteLinkRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetPasteLinkRequestsForTests(): void {
  pending = false;
  listeners.clear();
}
