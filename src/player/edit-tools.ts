/**
 * P10 Screenshot & edit tools (#675, #677–#680): which tool the Player offers for what is playing, where Trim starts,
 * and what a screenshot is called. Pure (no native code), so the rules are tested.
 *
 * - Screenshot works on every file the Player reads from the phone: library videos, videos on this device and files
 *   another app opened. It uses expo-video's frame grab on the player's own source, as the seek preview (F14) does, so
 *   never for an online stream, and only once a video frame has shown (never for audio).
 * - The editors (Trim, Extract audio, Video converter, Compress) take library items only: the native editor reads a
 *   library row (library/MediaEditor.kt). Videos on this device, files from other apps and streams don't get them.
 */

import { clampTrimRange, type TrimRange } from '@/media-edit/edit-plan';

/** What is playing, as far as the tools are concerned. */
export type PlayerToolSource = 'library' | 'device' | 'incoming' | 'stream' | 'none';

export function playerToolSource(input: {
  mediaId: string | null | undefined;
  isStream: boolean;
  isDevice: boolean;
  isIncoming: boolean;
}): PlayerToolSource {
  if (!input.mediaId) {
    return 'none';
  }
  if (input.isStream) {
    return 'stream';
  }
  if (input.isIncoming) {
    return 'incoming';
  }
  if (input.isDevice) {
    return 'device';
  }
  return 'library';
}

/** Screenshot (#675): a file on the phone that shows video, on a build that can save a frame. */
export function canScreenshot(input: { source: PlayerToolSource; hasVideoFrame: boolean; nativeAvailable: boolean }): boolean {
  return (
    input.nativeAvailable &&
    input.hasVideoFrame &&
    (input.source === 'library' || input.source === 'device' || input.source === 'incoming')
  );
}

/**
 * The editors (#677–#680): only for a video the library holds (the editor's sources are library rows), once the
 * library has answered with that item, on a build with the editor. Not for an audio file: every tool here is for a
 * video (Trim and Compress refuse audio, and its sound is already all there is).
 */
export function canEditInPlayer(input: {
  source: PlayerToolSource;
  libraryItemFound: boolean;
  /** The library item is a video (not `audio/*`). */
  isVideo: boolean;
  editorAvailable: boolean;
}): boolean {
  return input.editorAvailable && input.source === 'library' && input.libraryItemFound && input.isVideo;
}

/** Trim from the Player (#677): from the moment playing to the end, made valid (at least 1 s, inside the video). */
export function trimRangeFromPosition(positionSeconds: number, durationMs: number | null | undefined): TrimRange | null {
  const length = typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : 0;
  const startMs = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) * 1000 : 0;
  const check = clampTrimRange({ startMs, endMs: length }, durationMs);
  return check.ok ? check.range : null;
}

/** Parses Trim's optional `startMs` route param (a whole number of ms); null when absent or not a number. */
export function parseTrimStartParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw.trim())) {
    return null;
  }
  return Number(raw.trim());
}

/** "12m05.4s", "1h02m05.4s": the frame's moment, readable in a file name (no ':' — Android file names refuse it). */
export function formatFrameStamp(seconds: number): string {
  const tenths = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 10 + 1e-6) : 0;
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const secondsPart = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  const mmss = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}m${String(secondsPart).padStart(2, '0')}.${tenth}s`;
  return hours > 0 ? `${hours}h${mmss}` : mmss;
}

/** Longest video title kept in a screenshot's name, in code points (Urdu and emoji stay whole). */
export const MAX_SCREENSHOT_TITLE_LENGTH = 100;

/**
 * The screenshot's name: "<video title> <moment>", never the video file's own name. The native side makes it a safe
 * file name, and the Gallery keeps two of the same name apart ("… (2).jpg").
 */
export function screenshotTitle(videoTitle: string | null | undefined, seconds: number, fallback: string): string {
  const base = (videoTitle ?? '').trim() || fallback.trim() || 'Screenshot';
  const points = Array.from(base);
  const kept = points.length > MAX_SCREENSHOT_TITLE_LENGTH ? points.slice(0, MAX_SCREENSHOT_TITLE_LENGTH).join('').trimEnd() : base;
  return `${kept} ${formatFrameStamp(seconds)}`;
}

/** What each edit writes: a new file, `.m4a` for the sound alone and `.mp4` for the rest (library/MediaEditor.kt). */
export function editOutputExtension(kind: 'trim' | 'mp4' | 'audio' | 'compress'): 'm4a' | 'mp4' {
  return kind === 'audio' ? 'm4a' : 'mp4';
}

/** Screenshots are always JPEG (library/ThumbnailExport.kt). */
export const SCREENSHOT_EXTENSION = 'jpg';

/**
 * "Pause the player while a job runs": once an edit started from the Player runs, a video that starts playing again is
 * paused (the editor and the player would share the phone's video decoders).
 */
export function shouldHoldPause(input: { editRunning: boolean; startedFromPlayer: boolean; isPlaying: boolean }): boolean {
  return input.editRunning && input.startedFromPlayer && input.isPlaying;
}
