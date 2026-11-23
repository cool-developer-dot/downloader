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
  ui: PlayerOptionUi;
};

export type PlayerOptionDefinition = PlayerOptionRow<PlayerOptionContext, TranslationKey, DsIconName>;

export const playerOptions = createPlayerOptionsRegistry<PlayerOptionContext, TranslationKey, DsIconName>();

/** The video can take commands (loaded, no error). */
export function playerReady(ctx: PlayerOptionContext): boolean {
  return ctx.session.isReady && !ctx.session.hasError;
}
