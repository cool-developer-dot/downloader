/**
 * P5 Repeat & loops — its rows in the options sheet, under Playback after P1's (10–40): "When the video ends" (#535,
 * with Repeat one #539 and Repeat all #540) 50, and A-B repeat (#541, with saved loops #722) 60.
 */

import { playerOptions, playerReady, type PlayerOptionDefinition } from './player-options';

export const P5_OWNER = 'P5';

export const P5_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p5.endOfPlayback',
    section: 'playback',
    order: 50,
    label: 'videoPlayer.endOfPlayback',
    icon: 'repeat',
    value: (ctx) => ctx.repeat?.endActionLabel ?? null,
    visible: (ctx) => ctx.repeat != null,
    onPress: (ctx) => ctx.ui.openEndOfPlayback?.(),
  },
  {
    id: 'p5.abRepeat',
    section: 'playback',
    order: 60,
    label: 'videoPlayer.tileAbRepeat',
    subtitle: 'videoPlayer.abRepeatRowHint',
    icon: 'timer',
    value: (ctx) => ctx.repeat?.abLabel ?? null,
    visible: (ctx) => ctx.repeat != null,
    enabled: playerReady,
    onPress: (ctx) => ctx.ui.openAbRepeat?.(),
  },
];

playerOptions.register(P5_OWNER, P5_PLAYER_OPTIONS);
