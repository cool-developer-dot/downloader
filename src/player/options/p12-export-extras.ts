/**
 * P12 Export extras — its rows in the options sheet, under Tools (P12 uses 72–76; P10 has 50–70, P8 80, P11 85,
 * P9 90): Create GIF 72 (#676), Merge videos 74 (#682), Change speed 76 (#684).
 *
 * Library videos only, like P10's editors (src/player/edit-tools.ts), and each only when this build's native side has
 * it. Each saves something NEW (a GIF in the Gallery, or a new Library item) and pauses the video; while an edit of
 * this video runs, the rows show its progress and open it.
 */

import { playerOptions, playerReady, type PlayerOptionContext, type PlayerOptionDefinition } from './player-options';

export const P12_OWNER = 'P12';

function running(ctx: PlayerOptionContext): string | null {
  return ctx.exportExtras?.running ?? null;
}

export const P12_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p12.createGif',
    section: 'tools',
    order: 72,
    label: 'videoPlayer.createGif',
    subtitle: 'videoPlayer.createGifHint',
    icon: 'images',
    value: running,
    visible: (ctx) => ctx.exportExtras?.canGif === true,
    // It starts from the moment playing.
    enabled: playerReady,
    onPress: (ctx) => ctx.exportExtras?.openGif(),
  },
  {
    id: 'p12.mergeVideos',
    section: 'tools',
    order: 74,
    label: 'videoPlayer.mergeVideos',
    subtitle: 'videoPlayer.mergeVideosHint',
    icon: 'layers',
    value: running,
    visible: (ctx) => ctx.exportExtras?.canMerge === true,
    onPress: (ctx) => ctx.exportExtras?.openMerge(),
  },
  {
    id: 'p12.changeSpeed',
    section: 'tools',
    order: 76,
    label: 'videoPlayer.changeSpeed',
    subtitle: 'videoPlayer.changeSpeedHint',
    icon: 'gauge',
    value: running,
    visible: (ctx) => ctx.exportExtras?.canSpeed === true,
    onPress: (ctx) => ctx.exportExtras?.openSpeed(),
  },
];

playerOptions.register(P12_OWNER, P12_PLAYER_OPTIONS);
