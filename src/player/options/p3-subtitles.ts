/**
 * P3 Subtitles: load & tracks — its rows in the options sheet, all under Subtitles (screen 21's rows, in its order):
 * Subtitle track (#598) 10, Load subtitle (#589) 20, Auto-detect (#590) 30, Sync (#597) 40, Encoding (#601) 50,
 * Subtitle off (#602) 90. P4 adds its style and second-track rows in between (60, 70).
 */

import { formatSubtitleOffset } from '../subtitles/cues';

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const P3_OWNER = 'P3';

export const P3_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p3.track',
    section: 'subtitles',
    order: 10,
    label: 'videoPlayer.subtitleTrack',
    icon: 'captions',
    value: (ctx) => ctx.subtitles.label ?? ctx.t('videoPlayer.subtitleOffValue'),
    onPress: (ctx) => ctx.ui.openSubtitleTracks(),
  },
  {
    id: 'p3.load',
    section: 'subtitles',
    order: 20,
    label: 'videoPlayer.subtitleLoad',
    subtitle: 'videoPlayer.subtitleLoadHint',
    icon: 'download',
    onPress: (ctx) => ctx.ui.loadSubtitleFile(),
  },
  {
    id: 'p3.autoDetect',
    section: 'subtitles',
    order: 30,
    label: 'videoPlayer.subtitleAutoDetect',
    subtitle: 'videoPlayer.subtitleAutoDetectHint',
    icon: 'search',
    toggle: (ctx) => ctx.subtitles.autoDetect,
    onPress: (ctx) => ctx.ui.setSubtitleAutoDetect(!ctx.subtitles.autoDetect),
  },
  {
    id: 'p3.sync',
    section: 'subtitles',
    order: 40,
    label: 'videoPlayer.subtitleSync',
    icon: 'clock',
    // A track inside the video is timed by the player itself: sync applies to subtitle files.
    value: (ctx) => (ctx.subtitles.isFile ? formatSubtitleOffset(ctx.subtitles.offsetMs) : ctx.t('videoPlayer.subtitleSyncFileOnly')),
    enabled: (ctx) => ctx.subtitles.isFile,
    onPress: (ctx) => ctx.ui.openSubtitleSync(),
  },
  {
    id: 'p3.encoding',
    section: 'subtitles',
    order: 50,
    label: 'videoPlayer.subtitleEncoding',
    icon: 'file-text',
    value: (ctx) => ctx.subtitles.encodingLabel,
    visible: (ctx) => ctx.subtitles.isFile,
    onPress: (ctx) => ctx.ui.openSubtitleEncoding(),
  },
  {
    id: 'p3.off',
    section: 'subtitles',
    order: 90,
    label: 'videoPlayer.subtitleOff',
    icon: 'ban',
    visible: (ctx) => ctx.subtitles.label != null,
    onPress: (ctx) => ctx.ui.subtitlesOff(),
  },
];

playerOptions.register(P3_OWNER, P3_PLAYER_OPTIONS);
