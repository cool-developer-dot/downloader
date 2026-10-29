/**
 * A request from another screen ("Paste link" with nothing to paste) to show the browser with the address bar
 * focused and the keyboard up. The address bar takes it when the Browser screen gains focus; a request nobody takes
 * within a few seconds expires, so it can never steal focus later.
 */

const REQUEST_TTL_MS = 5_000;

let requestedAt: number | null = null;
let requestedPrefill: string | null = null;
const listeners = new Set<() => void>();

/** `prefill` (B5 "Search this site": `site:example.com `) is put in the field, caret at the end. */
export function requestAddressBarFocus(options?: { prefill?: string }): void {
  requestedAt = Date.now();
  requestedPrefill = options?.prefill ?? null;
  for (const listener of listeners) {
    listener();
  }
}

/** The live request (once), with its prefill; null when there is none. */
export function takeAddressBarFocusRequest(): { prefill: string | null } | null {
  const at = requestedAt;
  const prefill = requestedPrefill;
  requestedAt = null;
  requestedPrefill = null;
  return at != null && Date.now() - at <= REQUEST_TTL_MS ? { prefill } : null;
}

export function subscribeAddressBarFocusRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
