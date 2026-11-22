/**
 * P2 Video fit & display — its rows in the options sheet, all under Video (P1's orientation lock is 10):
 * Aspect ratio (#564 / #565 / #566) 20, Mirror / Flip (#573) 30, Info overlay (#721) 40, Notch area (#576) 50.
 * The info overlay and the notch area are on / off rows; the other two open the Player's sheets.
 */

import { mirrorModeLabel, videoFitLabel } from '../video-display-labels';

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P2_OWNER = 'P2';

export const P2_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p2.aspectRatio',
    section: 'video',
    order: 20,
    label: 'videoPlayer.tileAspectRatio',
    icon: 'sliders-vertical',
    value: (ctx) => videoFitLabel(ctx.t, ctx.display.fit),
    onPress: (ctx) => ctx.ui.openAspectRatio(),
  },
  {
    id: 'p2.mirrorFlip',
    section: 'video',
    order: 30,
    label: 'videoPlayer.tileMirrorFlip',
    icon: 'flip-horizontal-2',
    value: (ctx) => mirrorModeLabel(ctx.t, ctx.display.mirror),
    onPress: (ctx) => ctx.ui.openMirrorFlip(),
  },
  {
    id: 'p2.infoOverlay',
    section: 'video',
    order: 40,
    label: 'videoPlayer.infoOverlay',
    subtitle: 'videoPlayer.infoOverlayHint',
    icon: 'info',
    toggle: (ctx) => ctx.display.infoOverlay,
    onPress: (ctx) => ctx.ui.setInfoOverlay(!ctx.display.infoOverlay),
  },
  {
    id: 'p2.notchArea',
    section: 'video',
    order: 50,
    label: 'videoPlayer.notchArea',
    subtitle: 'videoPlayer.notchAreaHint',
    icon: 'smartphone',
    toggle: (ctx) => ctx.display.fillCutout,
    onPress: (ctx) => ctx.ui.setFillCutout(!ctx.display.fillCutout),
  },
];

playerOptions.register(P2_OWNER, P2_PLAYER_OPTIONS);
