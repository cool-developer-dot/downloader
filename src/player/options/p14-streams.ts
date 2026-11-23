/**
 * Faran's P14 Streams in the player — its rows in the options sheet, for online streams only: Stream quality (#670,
 * Video) and Download this stream (#672, Tools). Orders 60 in Video and 15 in Tools.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P14_OWNER = 'P14';

export const P14_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p14.streamQuality',
    section: 'video',
    order: 60,
    label: 'playerEngine.streamQuality',
    icon: 'gauge',
    visible: (ctx) => ctx.engine?.stream != null,
    value: (ctx) => ctx.engine?.stream?.qualityLabel ?? null,
    onPress: (ctx) => ctx.engine?.stream?.openQuality(),
  },
  {
    id: 'p14.downloadStream',
    section: 'tools',
    order: 15,
    label: 'playerEngine.streamDownload',
    subtitle: 'playerEngine.streamDownloadSub',
    icon: 'download',
    visible: (ctx) => ctx.engine?.stream != null,
    onPress: (ctx) => ctx.engine?.stream?.download(),
  },
];

playerOptions.register(P14_OWNER, P14_PLAYER_OPTIONS);
