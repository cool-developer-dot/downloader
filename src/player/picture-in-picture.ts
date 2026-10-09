import { Platform } from 'react-native';
import { isPictureInPictureSupported } from 'expo-video';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

/**
 * Whether the player may use a PiP window: Android 8+ with the system feature, and a native build that reports when
 * the activity stops (without that signal a video whose window never opened could keep playing unseen).
 */
export function pictureInPictureSupported(): boolean {
  if (Platform.OS !== 'android' || !isVidoraMediaAvailable()) {
    return false;
  }
  try {
    if (typeof getVidoraMedia().setPictureInPictureAutoEnter !== 'function') {
      return false;
    }
    return isPictureInPictureSupported();
  } catch {
    return false;
  }
}

/** Calls `listener` whenever the activity stops being visible (see `onActivityStop`). Returns the unsubscribe. */
export function subscribeActivityStopped(listener: (event: { inPictureInPicture: boolean }) => void): () => void {
  if (Platform.OS !== 'android' || !isVidoraMediaAvailable()) {
    return () => {};
  }
  try {
    const subscription = getVidoraMedia().addListener('onActivityStop', listener);
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/**
 * Tells the native side whether leaving VidoraX now should open the PiP window. Android 12+ uses the player view's
 * own auto-enter; Android 8–11 need the activity to ask from `onUserLeaveHint`, which this arms. Never throws.
 */
export function armNativePictureInPicture(armed: boolean, size: { width: number; height: number } | null): void {
  if (Platform.OS !== 'android' || !isVidoraMediaAvailable()) {
    return;
  }
  try {
    const media = getVidoraMedia();
    if (typeof media.setPictureInPictureAutoEnter !== 'function') {
      return;
    }
    const width = size ? Math.round(size.width) : 0;
    const height = size ? Math.round(size.height) : 0;
    media.setPictureInPictureAutoEnter(armed, width, height);
  } catch {
    // PiP is a convenience: an older native build or a platform refusal simply means no window.
  }
}
