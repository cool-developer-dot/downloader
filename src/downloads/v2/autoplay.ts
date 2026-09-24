/**
 * Playing a video the moment its download finishes — but only the one the user just started, and only while
 * they are still in the app. A completion that happened in the background, or for an older download, must never
 * yank the user out of what they are doing.
 */

export type AutoPlayDecisionInput = {
  downloadId: string;
  /** The download this session started most recently from the browser CTA or the quality sheet. */
  startedId: string | null;
  /** Whether that start already produced a playback. */
  alreadyPlayed: boolean;
  /** React Native AppState: only 'active' means the user is looking at VidoraX. */
  appState: string;
  /** False when the item has no verified file to play (no library item yet). */
  playable: boolean;
};

export function shouldAutoPlay(input: AutoPlayDecisionInput): boolean {
  if (input.appState !== 'active') {
    return false;
  }
  if (!input.playable || input.alreadyPlayed) {
    return false;
  }
  return input.startedId !== null && input.startedId === input.downloadId;
}

let startedId: string | null = null;
let playedId: string | null = null;

/** Remembers the download the user just started, so its completion is the only one that may auto-play. */
export function markDownloadStarted(downloadId: string): void {
  if (startedId !== downloadId) {
    startedId = downloadId;
    playedId = null;
  }
}

export function forgetAutoPlayTarget(): void {
  startedId = null;
  playedId = null;
}

export function autoPlayTarget(): string | null {
  return startedId;
}

/**
 * Called on every completion. Returns the id to play, or null. Consumes the target, so one start can only
 * produce one playback however many times the engine re-announces the state.
 */
export function claimAutoPlay(input: Omit<AutoPlayDecisionInput, 'startedId' | 'alreadyPlayed'>): string | null {
  const decision = shouldAutoPlay({
    ...input,
    startedId,
    alreadyPlayed: playedId === input.downloadId,
  });
  if (!decision) {
    return null;
  }
  playedId = input.downloadId;
  startedId = null;
  return input.downloadId;
}
