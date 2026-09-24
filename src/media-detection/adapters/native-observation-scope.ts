/** Physical WebView ownership for passive native events. No React or native imports. */
export type NativeObservationScope = {
  tabId: string;
  navigationEpoch: number;
  pageUrl: string;
  active: boolean;
  boundAt: number;
};
const scopes = new Map<number, NativeObservationScope>();

export function registerNativeObservationScope(viewTag: number, scope: Omit<NativeObservationScope, 'boundAt'>): () => void {
  const previous = scopes.get(viewTag);
  const next = { ...scope, boundAt: previous?.tabId === scope.tabId && previous.navigationEpoch === scope.navigationEpoch ? previous.boundAt : Date.now() };
  scopes.set(viewTag, next);
  while (scopes.size > 2) scopes.delete(scopes.keys().next().value!);
  return () => { if (scopes.get(viewTag) === next) scopes.delete(viewTag); };
}

export function resolveNativeObservationScope(input: {
  webViewId?: number; parentViewId?: number; observedAt?: number;
  observationSource?: string | null; requestReferer?: string | null;
}): NativeObservationScope | null {
  let scope = scopes.get(input.parentViewId ?? -1) ?? scopes.get(input.webViewId ?? -1);
  if (!scope && input.observationSource === 'service-worker' && input.requestReferer) {
    // ServiceWorkerClient has no WebView parameter. Require unique document evidence: the page itself, or —
    // since a worker's passthrough fetch to another origin (a CDN) keeps only its page's origin as Referer —
    // the only mounted page of that origin. Anything ambiguous stays unowned.
    const all = [...scopes.values()];
    const documents = all.filter((s) => sameDocument(s.pageUrl, input.requestReferer!));
    const matches = documents.length > 0 ? documents : all.filter((s) => sameOrigin(s.pageUrl, input.requestReferer!));
    if (matches.length === 1) scope = matches[0];
  }
  if (!scope?.active || input.observedAt == null || input.observedAt < scope.boundAt) return null;
  return scope;
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function sameDocument(a: string, b: string): boolean {
  try { const x = new URL(a); const y = new URL(b); x.hash = ''; y.hash = ''; return x.href === y.href; } catch { return false; }
}
