/**
 * P7 Playlists — its row in the options sheet, under Tools after P1's "Save to VidoraX" (10): "Add to playlist"
 * (#617) at 30, for the video playing. Tools 30–40 are P7's.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P7_OWNER = 'P7';

export const P7_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p7.addToPlaylist',
    section: 'tools',
    order: 30,
    label: 'playlists.addToPlaylist',
    icon: 'list',
    visible: (ctx) => ctx.playlists?.canAdd === true,
    onPress: (ctx) => ctx.playlists?.openAddSheet(),
  },
];

playerOptions.register(P7_OWNER, P7_PLAYER_OPTIONS);
