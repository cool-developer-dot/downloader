/**
 * B9 #91 — broken link check. Pure apart from the injected `fetch`.
 *
 * 4 at a time, 10 s per link, **no cookies** (`credentials: 'omit'`: on Android react-native then uses OkHttp's
 * `CookieJar.NO_COOKIES`, so no logged-in session goes to any site), redirects followed. HEAD first; GET when a site
 * refuses HEAD (405 / 501, or 403 some servers give HEAD only). Results:
 * - **Works** — 2xx / 3xx at the same address, or 401 / 403 / 429 (the site is there; it wants a login or rate-limits);
 * - **Moved** — it answered at a different address after redirects (the new one is offered);
 * - **Not found** — 404 / 410 and other 4xx;
 * - **Unreachable** — no answer, a timeout, or 5xx.
 * Nothing is ever deleted or changed by the check itself.
 */

export type LinkCheckStatus = 'works' | 'moved' | 'notFound' | 'unreachable';

export type LinkCheckResult = { id: string; url: string; status: LinkCheckStatus; newUrl: string | null };

export const LINK_CHECK_CONCURRENCY = 4;
export const LINK_CHECK_TIMEOUT_MS = 10_000;

/** Same page: scheme, host (case and `www.` ignored) and path (trailing slash ignored) and query; the fragment never counts. */
export function sameAddress(a: string, b: string): boolean {
  const norm = (value: string) => {
    try {
      const url = new URL(value);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, '')}${url.port ? `:${url.port}` : ''}${path}${url.search}`;
    } catch {
      return value;
    }
  };
  return norm(a) === norm(b);
}

export function classifyResponse(requestedUrl: string, status: number, finalUrl: string | null): { status: LinkCheckStatus; newUrl: string | null } {
  if (status >= 500 || status <= 0) return { status: 'unreachable', newUrl: null };
  if (status === 404 || status === 410) return { status: 'notFound', newUrl: null };
  if (status >= 400 && status !== 401 && status !== 403 && status !== 429) return { status: 'notFound', newUrl: null };
  const moved = finalUrl && /^https?:\/\//i.test(finalUrl) && !sameAddress(requestedUrl, finalUrl);
  return moved ? { status: 'moved', newUrl: finalUrl } : { status: 'works', newUrl: null };
}

type FetchLike = (url: string, init: { method: string; credentials: 'omit'; redirect: 'follow'; signal: AbortSignal; headers?: Record<string, string> }) => Promise<{ status: number; url: string }>;

async function request(fetchImpl: FetchLike, url: string, method: 'HEAD' | 'GET', outer: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await fetchImpl(url, { method, credentials: 'omit', redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export async function checkOne(
  item: { id: string; url: string },
  fetchImpl: FetchLike,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LinkCheckResult> {
  const timeoutMs = options.timeoutMs ?? LINK_CHECK_TIMEOUT_MS;
  try {
    let response = await request(fetchImpl, item.url, 'HEAD', options.signal, timeoutMs);
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      response = await request(fetchImpl, item.url, 'GET', options.signal, timeoutMs);
    }
    return { id: item.id, url: item.url, ...classifyResponse(item.url, response.status, response.url || null) };
  } catch {
    return { id: item.id, url: item.url, status: 'unreachable', newUrl: null };
  }
}

/**
 * Checks every item, `concurrency` at a time, calling `onResult` as each finishes. Cancel with `signal`: nothing new
 * starts, running requests are aborted, and the results so far are returned.
 */
export async function checkLinks(
  items: readonly { id: string; url: string }[],
  fetchImpl: FetchLike,
  options: { signal?: AbortSignal; concurrency?: number; timeoutMs?: number; onResult?: (result: LinkCheckResult, done: number, total: number) => void } = {},
): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && !options.signal?.aborted) {
      const item = items[next++];
      const result = await checkOne(item, fetchImpl, options);
      if (options.signal?.aborted) return;
      results.push(result);
      options.onResult?.(result, results.length, items.length);
    }
  };
  const count = Math.max(1, Math.min(options.concurrency ?? LINK_CHECK_CONCURRENCY, items.length));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}
