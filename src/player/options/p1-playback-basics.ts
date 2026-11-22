/**
 * P1 Playback basics — its rows in the options sheet. Playback: Stop (#520), Jump to time (#532), Seek interval
 * (#527), Frame by frame (#531). Video: the orientation lock. Tools: "Save to VidoraX" for a file another app opened.
 * Orders 10–40 in Playback, 10 in Video and Tools; other packages use their own numbers.
 */

import { playerOptions, playerReady, type PlayerOptionDefinition } from './player-options';

export const P1_OWNER = 'P1';

export const P1_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p1.stop',
    section: 'playback',
    order: 10,
    label: 'videoPlayer.stop',
    icon: 'square',
    enabled: playerReady,
    onPress: (ctx) => ctx.ui.stop(),
  },
  {
    id: 'p1.jumpToTime',
    section: 'playback',
    order: 20,
    label: 'videoPlayer.jumpToTime',
    icon: 'clock',
    enabled: playerReady,
    onPress: (ctx) => ctx.ui.openJumpToTime(),
  },
  {
    id: 'p1.seekInterval',
    section: 'playback',
    order: 30,
    label: 'videoPlayer.seekInterval',
    icon: 'fast-forward',
    value: (ctx) => ctx.t('videoPlayer.seekIntervalOption', { seconds: ctx.seekStepSeconds }),
    onPress: (ctx) => ctx.ui.openSeekInterval(),
  },
  {
    id: 'p1.frameByFrame',
    section: 'playback',
    order: 40,
    label: 'videoPlayer.frameTitle',
    icon: 'film',
    enabled: playerReady,
    onPress: (ctx) => ctx.ui.openFrameByFrame(),
  },
  {
    id: 'p1.orientation',
    section: 'video',
    order: 10,
    label: 'player.orientationTitle',
    icon: 'rotate-cw',
    value: (ctx) => ctx.t(`player.orientation.${ctx.orientationMode}`),
    onPress: (ctx) => ctx.ui.openOrientation(),
  },
  {
    id: 'p1.saveToLibrary',
    section: 'tools',
    order: 10,
    label: 'player.saveToLibrary',
    icon: 'save',
    visible: (ctx) => ctx.incoming?.saveState === 'idle',
    onPress: (ctx) => ctx.ui.saveToLibrary(),
  },
];

playerOptions.register(P1_OWNER, P1_PLAYER_OPTIONS);
