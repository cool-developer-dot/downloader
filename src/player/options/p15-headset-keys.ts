/**
 * Faran's P15 Headset, keys & remotes — its row in the options sheet: "Headset, keys & lock screen" (Playback, 210),
 * the sheet with Pause when headphones are unplugged (#560), Headset buttons (#661), Volume keys (#562), Keyboard and
 * remote keys (#701) and Show on lock screen (#703).
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P15_OWNER = 'P15';

export const P15_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p15.headsetKeys',
    section: 'playback',
    order: 210,
    label: 'playerEngine.keysTitle',
    subtitle: 'playerEngine.keysRowSub',
    icon: 'keyboard',
    visible: (ctx) => ctx.engine != null,
    onPress: (ctx) => ctx.engine?.headsetKeys.open(),
  },
];

playerOptions.register(P15_OWNER, P15_PLAYER_OPTIONS);
