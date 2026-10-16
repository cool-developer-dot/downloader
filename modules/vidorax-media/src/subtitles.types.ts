/**
 * H19 Subtitles: the part of the `VidoraMedia` contract about subtitle tracks (kept apart from VidoraMedia.types.ts so
 * the engine contract stays as it is). A track's URL never reaches JavaScript: it may carry a signature, and the
 * native side reads it again from the manifest when the subtitle is fetched.
 */

/** Why a listed track cannot be downloaded: protected, inside the video segments (stpp/wvtt), segmented DASH text, or another format. */
export type SubtitleRefusal = 'encrypted' | 'embedded' | 'segmented' | 'unsupported';

export type SubtitleTrackInfo = {
  /** Stable for the same stream; pass it back to choose the track. */
  id: string;
  /** BCP-47 as the manifest says; null when it does not say. */
  language: string | null;
  name: string | null;
  format: 'webvtt' | 'ttml' | null;
  isDefault: boolean;
  isForced: boolean;
  refused: SubtitleRefusal | null;
};

/** A saved subtitle file beside its video. */
export type SavedSubtitle = {
  index: number;
  language: string | null;
  name: string | null;
  bytes: number;
};

/** What happened to a download's chosen subtitles. `note` explains a failure (Download Details translates it). */
export type DownloadSubtitles = {
  state: 'pending' | 'done' | 'failed';
  subtitles: SavedSubtitle[];
  /** Chosen tracks that could not be saved. */
  failed: number;
  note: 'unreadable' | 'gone' | 'failed' | 'not_converted' | null;
};
