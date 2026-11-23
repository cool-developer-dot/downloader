/**
 * P15 #562 Hardware Key Control and #701 External Remote: which keys the Player takes from the system while it is in
 * front, and what each does. Pure.
 *
 * A keyboard, a TV remote or a game pad (their keys reach the app like a keyboard's):
 *
 * | Keys | Action |
 * | --- | --- |
 * | Space, Enter, OK (D-pad centre), K | play / pause |
 * | ← / J, → / L | back / forward by the seek interval |
 * | ↑, ↓ | volume up / down |
 * | N (Shift+N), P (Shift+P) | next / previous video |
 * | F | full screen on / off |
 * | M | mute / unmute |
 * | Esc | leave full screen |
 *
 * Media keys (⏯ ⏭ ⏮ ⏩ ⏪ on a remote or a headset) are not taken here: they reach the Player's media session, which
 * hands ⏭ / ⏮ to the queue (QueueSessionPlayer). A key is only taken while the Player is in front with no sheet open
 * and the screen isn't locked — so typing in a sheet (Jump to time) always reaches the text field.
 */

import type { HeadsetKeySettings } from './headset-keys';

export type PlayerKeyAction =
  | 'togglePlay'
  | 'seekBack'
  | 'seekForward'
  | 'volumeUp'
  | 'volumeDown'
  | 'next'
  | 'previous'
  | 'toggleFullscreen'
  | 'toggleMute'
  | 'exitFullscreen';

const REMOTE_KEYS: Readonly<Record<string, PlayerKeyAction>> = {
  space: 'togglePlay',
  enter: 'togglePlay',
  center: 'togglePlay',
  k: 'togglePlay',
  left: 'seekBack',
  j: 'seekBack',
  right: 'seekForward',
  l: 'seekForward',
  up: 'volumeUp',
  down: 'volumeDown',
  n: 'next',
  'shift+n': 'next',
  p: 'previous',
  'shift+p': 'previous',
  f: 'toggleFullscreen',
  m: 'toggleMute',
  escape: 'exitFullscreen',
};

export const PLAYER_REMOTE_COMBOS: readonly string[] = Object.keys(REMOTE_KEYS);

export type PlayerKeyState = {
  /** The Player screen is focused and VidoraX is in front (not in picture-in-picture). */
  inFront: boolean;
  /** A sheet or dialog is open, or the screen is locked (Lock, Kid Lock): keys keep their normal job. */
  inputBlocked: boolean;
};

/** What the Player asks the key channel for now. */
export function playerKeyCapture(
  settings: Pick<HeadsetKeySettings, 'volumeKeys' | 'remoteKeys'>,
  state: PlayerKeyState,
): { volumeKeys: boolean; combos: readonly string[] } {
  if (!state.inFront || state.inputBlocked) {
    return { volumeKeys: false, combos: [] };
  }
  return {
    volumeKeys: settings.volumeKeys !== 'system',
    combos: settings.remoteKeys ? PLAYER_REMOTE_COMBOS : [],
  };
}

/** The action for a captured key (a key the Player didn't ask for gives null). */
export function playerKeyAction(
  key: string,
  settings: Pick<HeadsetKeySettings, 'volumeKeys' | 'remoteKeys'>,
): PlayerKeyAction | null {
  if (key === 'volumeUp' || key === 'volumeDown') {
    if (settings.volumeKeys === 'system') {
      return null;
    }
    if (settings.volumeKeys === 'seek') {
      return key === 'volumeUp' ? 'seekForward' : 'seekBack';
    }
    return key === 'volumeUp' ? 'volumeUp' : 'volumeDown';
  }
  return settings.remoteKeys ? (REMOTE_KEYS[key.toLowerCase()] ?? null) : null;
}

/** Android's media volume has 15 steps on most phones: one key press moves one step, like the system's own keys. */
export const VOLUME_KEY_STEPS = 15;

export function nextVolumeLevel(level: number, direction: 1 | -1, steps = VOLUME_KEY_STEPS): number {
  const current = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const step = Math.round(current * steps) + direction;
  return Math.min(steps, Math.max(0, step)) / steps;
}

/**
 * "Previous" from a headset, a remote or the notification: like every music and video app, after the first 3 s it
 * goes back to the start of this video; before that, to the previous video when there is one.
 */
export const RESTART_THRESHOLD_SECONDS = 3;

export function previousTarget(positionSeconds: number, hasPrevious: boolean): 'previous' | 'restart' {
  return hasPrevious && positionSeconds <= RESTART_THRESHOLD_SECONDS ? 'previous' : 'restart';
}
