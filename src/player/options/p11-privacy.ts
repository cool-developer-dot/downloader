/**
 * P11 Privacy & backup — its row in the options sheet:
 * - Tools 85: "Move to Private" (#686), for a library video only (not a video on this device, a file another app
 *   opened, or a stream). It opens Private's own move dialog: App Lock must be on, and the first move asks the user to
 *   confirm that private videos are lost if VidoraX is uninstalled. Then the next video in the queue plays, or the
 *   Player closes.
 * Tools orders used before: P1 10, P7 30, P9 40–45, P10 50–70, P8 80, P9 90 (P12 takes 72–76).
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P11_OWNER = 'P11';

export const P11_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p11.moveToPrivate',
    section: 'tools',
    order: 85,
    label: 'privateVault.moveAction',
    subtitle: 'privateVault.moveHint',
    icon: 'lock',
    visible: (ctx) => ctx.privacy?.moveToPrivate.available === true,
    onPress: (ctx) => ctx.privacy?.moveToPrivate.run(),
  },
];

playerOptions.register(P11_OWNER, P11_PLAYER_OPTIONS);
