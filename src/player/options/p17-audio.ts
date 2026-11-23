/**
 * Faran's P17 Audio tracks & delay — its rows in the options sheet's Audio section: Audio track (10, only when the
 * video has more than one), Audio delay (20) and Audio only (30, a switch). The first two open the Audio sheet.
 */

import { playerOptions, playerReady, type PlayerOptionDefinition } from './player-options';

export const P17_OWNER = 'P17';

export const P17_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p17.audioTrack',
    section: 'audio',
    order: 10,
    label: 'playerEngine.audioTrack',
    icon: 'languages',
    visible: (ctx) => ctx.engine?.audio.trackLabel != null,
    value: (ctx) => ctx.engine?.audio.trackLabel ?? null,
    onPress: (ctx) => ctx.engine?.audio.open(),
  },
  {
    id: 'p17.audioDelay',
    section: 'audio',
    order: 20,
    label: 'playerEngine.audioDelay',
    icon: 'clock',
    visible: (ctx) => ctx.engine != null,
    enabled: playerReady,
    value: (ctx) => ctx.engine?.audio.delayLabel ?? null,
    onPress: (ctx) => ctx.engine?.audio.open(),
  },
  {
    id: 'p17.audioOnly',
    section: 'audio',
    order: 30,
    label: 'playerEngine.audioOnly',
    subtitle: 'playerEngine.audioOnlySub',
    icon: 'music',
    visible: (ctx) => ctx.engine != null,
    toggle: (ctx) => ctx.engine?.audio.audioOnly === true,
    onPress: (ctx) => ctx.engine?.audio.setAudioOnly(!ctx.engine.audio.audioOnly),
  },
];

playerOptions.register(P17_OWNER, P17_PLAYER_OPTIONS);
