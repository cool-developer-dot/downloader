/**
 * B6 #240 Volume keys scroll pages (setting, default off). The keys are taken from the system (no volume change)
 * only while all of this holds; otherwise they keep their normal job. The native side takes them only while it is
 * asked to (`VidoraWeb.setKeyCapture`), so this decides every moment they are taken. Pure.
 */

export type VolumeKeyContext = {
  enabled: boolean;
  /** The Browser tab is the screen in front, and the app is in the foreground. */
  browserInFront: boolean;
  /** A web page is shown (not the start page) and nothing covers it (tab switcher, a sheet, the address bar). */
  pageShown: boolean;
  keyboardUp: boolean;
  /** The page is playing audio or video. */
  pageMediaPlaying: boolean;
  /** The app's own player is playing (also in the background or the mini player). */
  playerPlaying: boolean;
};

export function shouldCaptureVolumeKeys(context: VolumeKeyContext): boolean {
  return (
    context.enabled &&
    context.browserInFront &&
    context.pageShown &&
    !context.keyboardUp &&
    !context.pageMediaPlaying &&
    !context.playerPlaying
  );
}

/** Volume Down scrolls down a step, Volume Up up a step. */
export function volumeKeyDirection(key: string): 1 | -1 | 0 {
  if (key === 'volumeDown') return 1;
  if (key === 'volumeUp') return -1;
  return 0;
}
