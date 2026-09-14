import { isSameDocumentUrl } from '../utils';

let msePlaybackAt: number | null = null;
let msePlaybackPageUrl: string | null = null;

export function markMsePlayback(pageUrl: string): void {
  msePlaybackAt = Date.now();
  msePlaybackPageUrl = pageUrl;
}

export function clearMsePlayback(): void {
  msePlaybackAt = null;
  msePlaybackPageUrl = null;
}

export function getMsePlaybackContext(currentPageUrl: string | null): {
  msePlaybackActive: boolean;
  msePlaybackAgeMs: number | null;
} {
  if (!msePlaybackAt || !msePlaybackPageUrl || !currentPageUrl) {
    return { msePlaybackActive: false, msePlaybackAgeMs: null };
  }
  if (!isSameDocumentUrl(msePlaybackPageUrl, currentPageUrl)) {
    return { msePlaybackActive: false, msePlaybackAgeMs: null };
  }
  const ageMs = Date.now() - msePlaybackAt;
  return {
    msePlaybackActive: ageMs >= 0 && ageMs < 30_000,
    msePlaybackAgeMs: ageMs,
  };
}
