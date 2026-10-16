/**
 * Android reports the app as in the background while a system screen it opened is in front — the folder picker of
 * "Export to folder", or the storage permission prompt on Android 9 and older. Those are part of an action the user
 * just confirmed inside Private, so they must not lock it; anything else that backgrounds the app still does.
 */

let open = 0;

/** Runs `show` (which opens a system screen) without the section locking while that screen is in front. */
export async function withExternalUi<T>(show: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await show();
  } finally {
    open = Math.max(0, open - 1);
  }
}

export function isExternalUiOpen(): boolean {
  return open > 0;
}
