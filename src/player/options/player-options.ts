/**
 * The app's options sheet registry and what every row gets to work with. A package adds its rows from its own file
 * (see `p1-playback-basics.ts`) and adds one import line to `index.ts`; nothing else changes.
 *
 * Playback and Audio are meant to grow (Faran's sound and engine packages): a row there reads the session through
 * `ctx.session`, acts on the player through `ctx.controller` / `ctx.player`, and uses `ctx.ui` for the Player
 * screen's own sheets and seeks.
 */

import type { VideoPlayer } from 'expo-video';

import type { DsIconName } from '@/design';
import type { TranslateFn, TranslationKey } from '@/localization';

import type { OrientationMode } from '../orientation-mode';
import type { PlayerController } from '../types';
import type { MirrorMode, VideoFit } from '../video-display';

import { createPlayerOptionsRegistry, type PlayerOptionRow } from './registry';

/** The Player screen's own commands a row can call (they open its sheets and panels, and seek through the session). */
export type PlayerOptionUi = {
  /** #520: pause and go back to the start. */
  stop: () => void;
  openJumpToTime: () => void;
  openSeekInterval: () => void;
  openFrameByFrame: () => void;
  openOrientation: () => void;
  openSpeed: () => void;
  saveToLibrary: () => void;
  /** An exact seek through the session (the position and the finished state update at once). */
  seekTo: (seconds: number) => void;
  /** "Not available yet", shown and spoken. */
  notAvailableYet: () => void;
  /** P2 #564–#566: the Aspect ratio sheet (fit, crop, stretch, forced ratios). */
  openAspectRatio: () => void;
  /** P2 #573: the Mirror / Flip sheet. */
  openMirrorFlip: () => void;
  /** P2 #576: full screen lets the picture fill the camera cutout (remembered). */
  setFillCutout: (on: boolean) => void;
  /** P2 #721: the info overlay on the video (remembered). */
  setInfoOverlay: (on: boolean) => void;
  /** P3 #598 / #602: the subtitle track sheet (Off, tracks inside the video, subtitle files). */
  openSubtitleTracks: () => void;
  /** P3 #589: the system file picker for a subtitle file. */
  loadSubtitleFile: () => void;
  /** P3 #590: look for subtitle files named like the video (remembered, app-wide). */
  setSubtitleAutoDetect: (on: boolean) => void;
  /** P3 #597: the sync sheet. */
  openSubtitleSync: () => void;
  /** P3 #601: the encoding sheet. */
  openSubtitleEncoding: () => void;
  /** P3 #602: subtitles off for this video. */
  subtitlesOff: () => void;
  /** P4 #592–#596: the subtitle style sheet. */
  openSubtitleStyle: () => void;
  /** P4 #599: the second-subtitle sheet. */
  openSubtitleSecond: () => void;
};

export type PlayerOptionContext = {
  t: TranslateFn;
  mediaId: string | null;
  player: VideoPlayer;
  controller: PlayerController;
  /** What the Player shows now (read-only). */
  session: {
    isReady: boolean;
    isPlaying: boolean;
    hasError: boolean;
    positionSeconds: number;
    durationSeconds: number | null;
    playbackRate: number;
  };
  seekStepSeconds: number;
  orientationMode: OrientationMode;
  /** A file another app opened (not in the library) and whether it was saved; null for library videos. */
  incoming: { saveState: 'idle' | 'saving' | 'saved' } | null;
  /** P2: how the picture is shown — the fit (per video), mirror (this video), notch area and info overlay. */
  display: { fit: VideoFit; mirror: MirrorMode; fillCutout: boolean; infoOverlay: boolean };
  /** P3: the subtitles of this video. */
  subtitles: {
    /** What shows; null when subtitles are off. */
    label: string | null;
    /** A subtitle file shows (sync and encoding apply to files only). */
    isFile: boolean;
    offsetMs: number;
    /** The showing file's encoding ("Automatic (UTF-8)"); null when no file shows. */
    encodingLabel: string | null;
    autoDetect: boolean;
    /** P4 #599: the second subtitle; null when there is none. */
    secondLabel: string | null;
  };
  ui: PlayerOptionUi;
};

export type PlayerOptionDefinition = PlayerOptionRow<PlayerOptionContext, TranslationKey, DsIconName>;

export const playerOptions = createPlayerOptionsRegistry<PlayerOptionContext, TranslationKey, DsIconName>();

/** The video can take commands (loaded, no error). */
export function playerReady(ctx: PlayerOptionContext): boolean {
  return ctx.session.isReady && !ctx.session.hasError;
}
