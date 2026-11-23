/**
 * P14 #672 Download Integration: "Download this stream" from the Player or the Network stream screen hands the link to
 * the downloader's own flow (it checks the link and shows the quality sheet, as a pasted link does). That flow lives
 * in the tabs, while the Player and the Network stream screen open above them, so the request waits here until the
 * tabs are in front; `StreamDownloadHandoff` (mounted in the tabs) runs it. One request at a time: a newer one
 * replaces an older one not run yet. The link stays in memory only.
 */

export type StreamDownloadRequest = {
  url: string;
  /** The page the stream came from (a Browser offer), sent as Referer while the link is checked. */
  referer: string | null;
};

let pending: StreamDownloadRequest | null = null;
const listeners = new Set<() => void>();

export function requestStreamDownload(request: StreamDownloadRequest): void {
  const url = request.url.trim();
  if (!url) {
    return;
  }
  pending = { url, referer: request.referer?.trim() || null };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's failure never loses the request.
    }
  }
}

export function hasStreamDownloadRequest(): boolean {
  return pending != null;
}

/** The waiting request, removed (each request runs once). */
export function takeStreamDownloadRequest(): StreamDownloadRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribeStreamDownloadRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
