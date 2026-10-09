/**
 * "Video downloaded" when a download finishes while the user is in VidoraX. The user stays exactly where they are:
 * nothing navigates and nothing starts playing — the video is opened from Downloads, Library or its notification.
 * A completion in the background is left to the system notification.
 */

/** A notice shown this recently already says "Video downloaded"; a burst of completions shows one. */
export const COMPLETION_NOTICE_COALESCE_MS = 2500;
/** Ids already announced, so an engine re-announcing COMPLETED never repeats the notice. */
const REMEMBERED_IDS = 200;

export type CompletionNoticeInput = {
  downloadId: string;
  /** React Native AppState: only 'active' means the user is looking at VidoraX. */
  appState: string;
  /** False when the item has no verified file (no library item yet). */
  playable: boolean;
  now: number;
};

export type CompletionNotifier = {
  /** True when this completion should show the notice now. Remembers the id either way. */
  claim: (input: CompletionNoticeInput) => boolean;
  reset: () => void;
};

export function createCompletionNotifier(): CompletionNotifier {
  const announced = new Set<string>();
  let lastShownAt = Number.NEGATIVE_INFINITY;

  const remember = (id: string) => {
    announced.add(id);
    if (announced.size > REMEMBERED_IDS) {
      const oldest = announced.values().next().value;
      if (oldest !== undefined) {
        announced.delete(oldest);
      }
    }
  };

  return {
    claim: ({ downloadId, appState, playable, now }) => {
      if (!playable || announced.has(downloadId)) {
        return false;
      }
      remember(downloadId);
      if (appState !== 'active') {
        return false;
      }
      if (now - lastShownAt < COMPLETION_NOTICE_COALESCE_MS) {
        return false;
      }
      lastShownAt = now;
      return true;
    },
    reset: () => {
      announced.clear();
      lastShownAt = Number.NEGATIVE_INFINITY;
    },
  };
}
