/**
 * Android reports the app as in the background while a system screen it opened is in front — the folder picker of
 * "Export to folder", the storage permission prompt on Android 9 and older, Android's delete dialog for a Gallery
 * copy. Those are part of an action the user just confirmed inside Private, so they must not lock it; anything else
 * that backgrounds the app still does.
 *
 * Each also runs inside App Lock's shared `withExpectedSystemScreen` (fix/app-lock-grace), so App Lock itself does not
 * relock for it either when VidoraX is back within 30 seconds.
 */

import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

let open = 0;

/** Runs `show` (which opens a system screen) without the section — or App Lock — locking while it is in front. */
export async function withExternalUi<T>(show: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await withExpectedSystemScreen(show);
  } finally {
    open = Math.max(0, open - 1);
  }
}

export function isExternalUiOpen(): boolean {
  return open > 0;
}
