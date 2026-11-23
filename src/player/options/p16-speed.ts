/**
 * Faran's P16 Speed & pitch — its row in the options sheet: "Playback speed" (Playback, 15, between Stop and Jump to
 * time), its value the speed now. It opens the speed sheet (#537 fine speed, #538 natural voice, #544 the speed
 * button, #736 each video's speed).
 */

import { formatPlaybackRateChip } from '../playback-rates';

import { playerOptions, playerReady, type PlayerOptionDefinition } from './player-options';

export const P16_OWNER = 'P16';

export const P16_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p16.speed',
    section: 'playback',
    order: 15,
    label: 'playerEngine.speedTitle',
    icon: 'gauge',
    enabled: playerReady,
    value: (ctx) => formatPlaybackRateChip(ctx.session.playbackRate),
    onPress: (ctx) => ctx.ui.openSpeed(),
  },
];

playerOptions.register(P16_OWNER, P16_PLAYER_OPTIONS);
