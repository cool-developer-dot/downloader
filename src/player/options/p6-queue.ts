/**
 * P6 Queue & auto-next — its rows in the options sheet, under Playback after P5's (50, 60): Up next (#619) 70,
 * Shuffle (#542) 75, Auto play next (#534) 80, Next episode card (#733) 85.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P6_OWNER = 'P6';

export const P6_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p6.queue',
    section: 'playback',
    order: 70,
    label: 'videoPlayer.upNext',
    icon: 'list',
    value: (ctx) => ctx.queue?.countLabel ?? null,
    visible: (ctx) => ctx.queue != null,
    onPress: (ctx) => ctx.ui.openQueue?.(),
  },
  {
    id: 'p6.shuffle',
    section: 'playback',
    order: 75,
    label: 'videoPlayer.shuffle',
    subtitle: 'videoPlayer.shuffleHint',
    icon: 'shuffle',
    toggle: (ctx) => ctx.queue?.shuffled === true,
    visible: (ctx) => ctx.queue != null,
    enabled: (ctx) => (ctx.queue?.size ?? 0) > 1,
    onPress: (ctx) => ctx.ui.setShuffle?.(!(ctx.queue?.shuffled === true)),
  },
  {
    id: 'p6.autoPlayNext',
    section: 'playback',
    order: 80,
    label: 'videoPlayer.upNextSubtitle',
    subtitle: 'videoPlayer.autoPlayNextHint',
    icon: 'skip-forward',
    toggle: (ctx) => ctx.queue?.autoPlayNext === true,
    visible: (ctx) => ctx.queue != null,
    onPress: (ctx) => ctx.ui.setAutoPlayNext?.(!(ctx.queue?.autoPlayNext === true)),
  },
  {
    id: 'p6.nextEpisodePrompt',
    section: 'playback',
    order: 85,
    label: 'videoPlayer.nextEpisodePrompt',
    subtitle: 'videoPlayer.nextEpisodePromptHint',
    icon: 'tv',
    toggle: (ctx) => ctx.queue?.nextEpisodePrompt === true,
    visible: (ctx) => ctx.queue != null,
    onPress: (ctx) => ctx.ui.setNextEpisodePrompt?.(!(ctx.queue?.nextEpisodePrompt === true)),
  },
];

playerOptions.register(P6_OWNER, P6_PLAYER_OPTIONS);
