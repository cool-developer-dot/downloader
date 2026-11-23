/**
 * P9 #726 Quick Delete: "delete right after watching", from the Player. Pure rules; the screen runs the app's own
 * delete (the Library's "Delete from VidoraX", `deleteCompletedFileFromVidoraX`) after a confirm.
 *
 * - Offered only for a video in VidoraX's library (a finished download, COMPLETED in the downloads store). Never
 *   for a video from the phone's gallery (`device:` ids: VidoraX can't delete those without Android's own delete
 *   request, which the app's delete doesn't do), a file another app opened, or a stream.
 * - After the delete the Player moves to the next video in the queue; with none, it closes.
 */

import { queueNeighbours } from './play-queue';

export type QuickDeleteTarget = {
  mediaId: string | null;
  /** The downloads store has it as a finished download (a library video). */
  inLibrary: boolean;
  isDeviceVideo: boolean;
  isExternalFile: boolean;
  isStream: boolean;
};

export function canQuickDelete(target: QuickDeleteTarget): boolean {
  return (
    target.mediaId != null &&
    target.mediaId.trim().length > 0 &&
    target.inLibrary &&
    !target.isDeviceVideo &&
    !target.isExternalFile &&
    !target.isStream
  );
}

/**
 * What plays after the deleted video: the next in the queue (in its play order, shuffle included), or none. The
 * deleted video then leaves the queue through P6's own `removeFromPlayQueue`, once it is no longer the one playing.
 */
export function nextAfterQuickDelete(queue: readonly string[], mediaId: string): string | null {
  const { nextId } = queueNeighbours(queue, mediaId);
  return nextId != null && nextId !== mediaId ? nextId : null;
}
