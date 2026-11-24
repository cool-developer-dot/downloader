/**
 * P13 #667: what may be cast. Pure, so it is unit tested; the native side refuses the same files again
 * (cast/CastSources.kt).
 *
 * - **Private Folder videos are never cast**, however the Player got them: a vault item's id, the vault's decrypted
 *   playback file, or a library video moved to Private in this run.
 * - **A download still in progress** (play while downloading) waits: its file is still growing.
 * - **Online streams:** the TV opens the stream's own URL. One that needs the page's request headers (cookies, a
 *   referrer) can't be opened by a receiver; sending them would mean changing Faran's stream files (P14) to add a
 *   proxy, so such a stream is not cast (logged for Faran in the P13 work log).
 * - Anything that isn't a file on the phone or a web stream is refused.
 */

import { isMovedToPrivate } from '@/privacy/private-media-guard';
import { isPrivateFolderItemId, isPrivatePlaybackUri } from '@/privacy/private-folder';

export type CastBlockReason = 'private' | 'still_downloading' | 'stream_unsupported' | 'not_castable';

export type CastCandidate = {
  mediaId: string | null;
  /** The URI the Player plays (`PlaybackSource.uri`). */
  uri: string | null;
  /** An online stream's request headers (`PlaybackSource.headers`). */
  headers?: Readonly<Record<string, string>> | null;
};

const GROWING_AUTHORITY = /^content:\/\/[^/]*\.vidorax\.growing(\/|$)/i;
const WEB = /^https?:\/\//i;
const LOCAL = /^(file|content):\/\//i;

export function castBlockReason(candidate: CastCandidate): CastBlockReason | null {
  const { mediaId, uri } = candidate;
  if (isPrivateFolderItemId(mediaId) || isMovedToPrivate(mediaId) || isPrivatePlaybackUri(uri)) {
    return 'private';
  }
  if (!uri) {
    return 'not_castable';
  }
  if (GROWING_AUTHORITY.test(uri)) {
    return 'still_downloading';
  }
  if (WEB.test(uri)) {
    return candidate.headers && Object.keys(candidate.headers).length > 0 ? 'stream_unsupported' : null;
  }
  return LOCAL.test(uri) ? null : 'not_castable';
}

/** Whether the phone's own server is needed (a local file) rather than the stream's own URL. */
export function castNeedsLocalServer(uri: string): boolean {
  return LOCAL.test(uri);
}
