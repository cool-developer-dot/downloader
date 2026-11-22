/**
 * P4 Subtitle style — its rows in the options sheet, under Subtitles between P3's (screen 21's Style card and its
 * "Multiple tracks · dual subtitles" row): Style (#592–#596) 60, Second subtitle (#599) 70.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P4_OWNER = 'P4';

export const P4_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p4.style',
    section: 'subtitles',
    order: 60,
    label: 'videoPlayer.subtitleStyle',
    subtitle: 'videoPlayer.subtitleStyleHint',
    icon: 'palette',
    onPress: (ctx) => ctx.ui.openSubtitleStyle(),
  },
  {
    id: 'p4.second',
    section: 'subtitles',
    order: 70,
    label: 'videoPlayer.subtitleSecond',
    subtitle: 'videoPlayer.subtitleSecondHint',
    icon: 'languages',
    value: (ctx) => ctx.subtitles.secondLabel ?? ctx.t('videoPlayer.subtitleOffValue'),
    onPress: (ctx) => ctx.ui.openSubtitleSecond(),
  },
];

playerOptions.register(P4_OWNER, P4_PLAYER_OPTIONS);
