/**
 * P7 #618 — what a playlist's entries are now: the library video's current name, or the name kept when it was
 * added, and whether it can play. Pure (tested under Node).
 *
 * - A library video plays when the library still lists it and its file isn't missing (`canAttemptPlayback`, as the
 *   Library's own cards: "unverified" may play). An id the library no longer has at all (deleted in VidoraX, or a
 *   file removed outside it and reconciled away) is missing.
 * - A video already on the phone (`device:<id>`) plays only when VidoraX has listed it in this run (the Device videos
 *   list, or the listing the playlist screen asks for): the Player finds its file from that list. Until then it shows
 *   with the name kept when it was added, and says so.
 */

import { canAttemptPlayback } from '@/library/eligibility';
import type { LocalAvailability } from '@/library/types';
import type { PlaylistItem } from '@/storage/repositories/playlists.queries';

/** Same prefix as `src/player/device-media.ts` (`deviceMediaId`). */
const DEVICE_ID_PREFIX = 'device:';

export function isDeviceEntryId(mediaId: string): boolean {
  return mediaId.startsWith(DEVICE_ID_PREFIX);
}

/** The part of a library video an entry reads (a `MediaLibraryItem` fits). */
export type EntryLibraryInfo = {
  displayName: string;
  fileName: string;
  duration: number | null;
  localAvailability: LocalAvailability;
  thumbnailUri: string | null;
};

export type EntryLookup = {
  library: ReadonlyMap<string, EntryLibraryInfo>;
  /** A device video VidoraX has listed in this run (`knownDeviceVideo`), or null. */
  device: (mediaId: string) => { title: string; durationMs: number | null } | null;
};

export type PlaylistEntryView = {
  mediaId: string;
  position: number;
  title: string;
  fileName: string;
  durationSeconds: number | null;
  thumbnailUri: string | null;
  playable: boolean;
  /** Why it can't play: `gone` — the video is no longer there; `device` — a phone video not listed in this run. */
  missing: 'gone' | 'device' | null;
};

export function resolvePlaylistEntries(items: readonly PlaylistItem[], lookup: EntryLookup): PlaylistEntryView[] {
  return items.map((item) => {
    if (isDeviceEntryId(item.mediaId)) {
      const video = lookup.device(item.mediaId);
      return {
        mediaId: item.mediaId,
        position: item.position,
        title: video?.title?.trim() || item.title || item.fileName,
        fileName: item.fileName || video?.title || '',
        durationSeconds:
          video?.durationMs != null && video.durationMs > 0 ? video.durationMs / 1000 : item.durationSeconds,
        thumbnailUri: null,
        playable: video != null,
        missing: video != null ? null : 'device',
      };
    }
    const media = lookup.library.get(item.mediaId);
    const playable = media != null && canAttemptPlayback(media.localAvailability);
    return {
      mediaId: item.mediaId,
      position: item.position,
      title: media?.displayName?.trim() || item.title || item.fileName,
      fileName: media?.fileName || item.fileName,
      durationSeconds: media?.duration ?? item.durationSeconds,
      thumbnailUri: media?.thumbnailUri ?? null,
      playable,
      missing: playable ? null : 'gone',
    };
  });
}
