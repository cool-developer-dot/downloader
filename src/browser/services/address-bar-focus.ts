/**
 * A request from another screen ("Paste link" with nothing to paste) to show the browser with the address bar
 * focused and the keyboard up. The address bar takes it when the Browser screen gains focus; a request nobody takes
 * within a few seconds expires, so it can never steal focus later.
 */

const REQUEST_TTL_MS = 5_000;

let requestedAt: number | null = null;
const listeners = new Set<() => void>();

export function requestAddressBarFocus(): void {
  requestedAt = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

/** True once per live request. */
export function takeAddressBarFocusRequest(): boolean {
  const at = requestedAt;
  requestedAt = null;
  return at != null && Date.now() - at <= REQUEST_TTL_MS;
}

export function subscribeAddressBarFocusRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
