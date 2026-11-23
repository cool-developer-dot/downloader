/**
 * Faran's P18 Sleep timer & limits — its rows in the options sheet's Playback section: Sleep timer (140), Daily limit
 * (150) and Kid lock (160).
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P18_OWNER = 'P18';

export const P18_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p18.sleepTimer',
    section: 'playback',
    order: 140,
    label: 'playerEngine.sleepTitle',
    icon: 'moon',
    visible: (ctx) => ctx.engine != null,
    value: (ctx) => ctx.engine?.sleep.valueLabel ?? null,
    onPress: (ctx) => ctx.engine?.sleep.open(),
  },
  {
    id: 'p18.dailyLimit',
    section: 'playback',
    order: 150,
    label: 'playerEngine.limitTitle',
    icon: 'timer',
    visible: (ctx) => ctx.engine != null,
    value: (ctx) => ctx.engine?.limit.valueLabel ?? null,
    onPress: (ctx) => ctx.engine?.limit.open(),
  },
  {
    id: 'p18.kidLock',
    section: 'playback',
    order: 160,
    label: 'playerEngine.kidLock',
    subtitle: 'playerEngine.kidLockSub',
    icon: 'shield',
    visible: (ctx) => ctx.engine != null,
    onPress: (ctx) => ctx.engine?.kidLock.start(),
  },
];

playerOptions.register(P18_OWNER, P18_PLAYER_OPTIONS);
