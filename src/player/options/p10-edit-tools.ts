/**
 * P10 Screenshot & edit tools — its rows in the options sheet, under Tools (P10 uses 50–70; P1 has 10, P7 30, P9 40–45,
 * P8 80, P9 90): Screenshot 50 (#675), Trim video 55 (#677), Extract audio 60 (#678), Video converter 65 (#679),
 * Compress video 70 (#680).
 *
 * Screenshot shows for any file on the phone that shows video; the four editors only for a library video (see
 * src/player/edit-tools.ts). Every editor saves a NEW copy (the original is never changed) and pauses the video; while
 * one runs, its rows show the progress and open it.
 */

import { playerOptions, playerReady, type PlayerOptionContext, type PlayerOptionDefinition } from './player-options';

export const P10_OWNER = 'P10';

function canEdit(ctx: PlayerOptionContext): boolean {
  return ctx.editTools?.canEdit === true;
}

function running(ctx: PlayerOptionContext): string | null {
  return ctx.editTools?.running ?? null;
}

export const P10_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p10.screenshot',
    section: 'tools',
    order: 50,
    label: 'videoPlayer.screenshot',
    subtitle: 'videoPlayer.screenshotHint',
    icon: 'camera',
    visible: (ctx) => ctx.editTools?.canScreenshot === true,
    enabled: playerReady,
    onPress: (ctx) => ctx.editTools?.screenshot(),
  },
  {
    id: 'p10.trim',
    section: 'tools',
    order: 55,
    label: 'videoPlayer.trimVideo',
    subtitle: 'videoPlayer.trimVideoHint',
    icon: 'scissors',
    value: running,
    visible: canEdit,
    enabled: playerReady,
    onPress: (ctx) => ctx.editTools?.openTrim(),
  },
  {
    id: 'p10.extractAudio',
    section: 'tools',
    order: 60,
    label: 'videoPlayer.extractAudio',
    subtitle: 'videoPlayer.extractAudioHint',
    icon: 'music',
    value: running,
    visible: canEdit,
    onPress: (ctx) => ctx.editTools?.extractAudio(),
  },
  {
    id: 'p10.converter',
    section: 'tools',
    order: 65,
    label: 'videoPlayer.videoConverter',
    subtitle: 'videoPlayer.videoConverterHint',
    icon: 'refresh-cw',
    value: running,
    visible: canEdit,
    onPress: (ctx) => ctx.editTools?.openConverter(),
  },
  {
    id: 'p10.compress',
    section: 'tools',
    order: 70,
    label: 'videoPlayer.compressVideo',
    subtitle: 'videoPlayer.compressVideoHint',
    icon: 'archive',
    value: running,
    visible: (ctx) => canEdit(ctx) && ctx.editTools?.canCompress === true,
    onPress: (ctx) => ctx.editTools?.openCompress(),
  },
];

playerOptions.register(P10_OWNER, P10_PLAYER_OPTIONS);
