/**
 * Faran's P19 Audio effects & EQ — its rows in the options sheet's Audio section, after P17's: Equalizer (40, the
 * preset or Off) and Volume boost (50) open the Audio sheet; Night mode (60) and Mono (70) are switches.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P19_OWNER = 'P19';

export const P19_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p19.equalizer',
    section: 'audio',
    order: 40,
    label: 'playerEngine.eqSection',
    icon: 'sliders-horizontal',
    visible: (ctx) => ctx.engine != null,
    value: (ctx) => ctx.engine?.effects.eqLabel ?? null,
    onPress: (ctx) => ctx.engine?.effects.open(),
  },
  {
    id: 'p19.volumeBoost',
    section: 'audio',
    order: 50,
    label: 'playerEngine.volumeBoost',
    icon: 'zap',
    visible: (ctx) => ctx.engine != null,
    value: (ctx) => ctx.engine?.effects.boostLabel ?? null,
    onPress: (ctx) => ctx.engine?.effects.open(),
  },
  {
    id: 'p19.nightMode',
    section: 'audio',
    order: 60,
    label: 'playerEngine.nightMode',
    subtitle: 'playerEngine.nightModeSub',
    icon: 'moon',
    visible: (ctx) => ctx.engine != null,
    toggle: (ctx) => ctx.engine?.effects.nightMode === true,
    onPress: (ctx) => ctx.engine?.effects.set({ nightMode: !ctx.engine.effects.nightMode }),
  },
  {
    id: 'p19.mono',
    section: 'audio',
    order: 70,
    label: 'playerEngine.mono',
    subtitle: 'playerEngine.monoSub',
    icon: 'volume-2',
    visible: (ctx) => ctx.engine != null,
    toggle: (ctx) => ctx.engine?.effects.mono === true,
    onPress: (ctx) => ctx.engine?.effects.set({ mono: !ctx.engine.effects.mono }),
  },
];

playerOptions.register(P19_OWNER, P19_PLAYER_OPTIONS);
