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

import type { GestureSensitivity } from '../gesture-settings';
import type { OrientationMode } from '../orientation-mode';
import type { PlayerController } from '../types';
import type { MirrorMode, VideoFit } from '../video-display';
import type { PlayerEngineOption } from '../engine/types';

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
  /** P5 #535 / #539 / #540: the "When the video ends" sheet. */
  openEndOfPlayback?: () => void;
  /** P5 #541 / #722: the A-B repeat sheet (set A and B, clear, saved loops). */
  openAbRepeat?: () => void;
  /** P6 #619: the queue sheet ("Up next"). */
  openQueue?: () => void;
  /** P6 #542: shuffle the queue (the video playing keeps playing) or put it back in order. */
  setShuffle?: (on: boolean) => void;
  /** P6 #534: Auto Play Next (remembered, app-wide). */
  setAutoPlayNext?: (on: boolean) => void;
  /** P6 #733: the Next Episode card (remembered, app-wide). */
  setNextEpisodePrompt?: (on: boolean) => void;
  /** P8 #582–#587: the Gestures sheet (screen 20's card: the master switch, each gesture, the sensitivity). */
  openGestures: () => void;
  /** P8 #587: every gesture on / off at once (remembered; each gesture keeps its own switch). */
  setGesturesEnabled: (on: boolean) => void;
  /** P8 #586: the sensitivity sheet (Low, Normal, High). */
  openGestureSensitivity: () => void;
  /** P8 #692: the Customize controls sheet. */
  openCustomizeControls: () => void;
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
  /** P5: the End of Playback Action ("Stop", "Repeat one", "Repeat all") and the A-B loop ("Off", "A 1:23", "1:23–1:45"). */
  repeat?: { endActionLabel: string; abLabel: string };
  /** P6: the queue ("12 videos"), its shuffle, Auto Play Next and the Next Episode card. */
  queue?: { countLabel: string; size: number; shuffled: boolean; autoPlayNext: boolean; nextEpisodePrompt: boolean };
  /**
   * P7 #617: "Add to playlist" for the playing video. `canAdd` is false for what can't be in a playlist (a file another
   * app opened, a stream: their ids don't outlive the app). `openAddSheet` opens the Player's add sheet.
   */
  playlists?: { canAdd: boolean; openAddSheet: () => void };
  /** P8: the gesture settings (app-wide). */
  gestures: {
    /** The master switch ("Gesture controls"). */
    enabled: boolean;
    sensitivity: GestureSensitivity;
    /** How many gestures work now (0 while the master switch is off) … */
    onCount: number;
    /** … of how many. */
    total: number;
  };
  /**
   * P9: Disable History (#687, app-wide), this video's bookmarks (#705) and Quick Delete (#726). Optional, so the
   * other packages' tests build their context without it; the rows hide when it is missing.
   */
  p9?: {
    historyPaused: boolean;
    setHistoryPaused: (paused: boolean) => void;
    /** `available`: a video with a lasting id (not a file another app opened, not a stream). */
    bookmarks: { available: boolean; count: number; add: () => void; openList: () => void };
    /** `available`: a video in VidoraX's library (not a gallery video, another app's file or a stream). */
    quickDelete: { available: boolean; run: () => void };
  };
  /**
   * P10 Screenshot & edit tools (#675, #677–#680), under Tools. Screenshot is for any file on the phone that shows
   * video (not streams); the editors only for a library video (the native editor's sources are library items), so they
   * are hidden for videos on this device, files from other apps and streams. `running` is the edit's progress ("45%",
   * "Running") while an edit started from the Player runs; its rows then open that progress.
   */
  editTools?: {
    canScreenshot: boolean;
    canEdit: boolean;
    canCompress: boolean;
    running: string | null;
    screenshot: () => void;
    openTrim: () => void;
    extractAudio: () => void;
    openConverter: () => void;
    openCompress: () => void;
  };
  /**
   * P11 Privacy (#686): "Move to Private" for the playing video. `available` only for a library video on a build with
   * the vault (hidden for videos on this device, files from other apps and streams). `run` opens Private's own move
   * dialog (App Lock check, the data-loss warning); after the move the Player goes to the next video, or closes.
   */
  privacy?: {
    moveToPrivate: { available: boolean; run: () => void };
  };
  /**
   * P12 Export extras (#676, #682, #684), under Tools: Create GIF, Merge videos, Change speed — for a library video
   * only, like P10's editors, and only when this build's native side has each one. `running` is the edit's progress
   * while one of this video runs. Optional, so the other packages' tests build their context without it.
   */
  exportExtras?: {
    canGif: boolean;
    canMerge: boolean;
    canSpeed: boolean;
    running: string | null;
    openGif: () => void;
    openMerge: () => void;
    openSpeed: () => void;
  };
  /**
   * Faran's sound and engine packages (P14–P19): streams, keys, speed, audio, timers, effects. Optional, so the other
   * packages' tests build their context without it; its rows hide when it is missing.
   */
  engine?: PlayerEngineOption;
  ui: PlayerOptionUi;
};

export type PlayerOptionDefinition = PlayerOptionRow<PlayerOptionContext, TranslationKey, DsIconName>;

export const playerOptions = createPlayerOptionsRegistry<PlayerOptionContext, TranslationKey, DsIconName>();

/** The video can take commands (loaded, no error). */
export function playerReady(ctx: PlayerOptionContext): boolean {
  return ctx.session.isReady && !ctx.session.hasError;
}
