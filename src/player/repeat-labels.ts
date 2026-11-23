/**
 * P5: how the End of Playback Action and the A-B loop read in the options sheet, the A-B sheet and the timeline.
 */

import type { TranslateFn, TranslationKey } from '@/localization';

import { abLoopOf, type AbPoints } from './ab-repeat';
import type { EndOfPlaybackAction } from './end-of-playback';
import { formatPlaybackTime } from './format-time';

const END_ACTION_LABELS: Record<EndOfPlaybackAction, TranslationKey> = {
  stop: 'videoPlayer.endStop',
  repeatOne: 'videoPlayer.endRepeatOne',
  repeatAll: 'videoPlayer.endRepeatAll',
};

const END_ACTION_HINTS: Record<EndOfPlaybackAction, TranslationKey> = {
  stop: 'videoPlayer.endStopHint',
  repeatOne: 'videoPlayer.endRepeatOneHint',
  repeatAll: 'videoPlayer.endRepeatAllHint',
};

export function endOfPlaybackLabel(t: TranslateFn, action: EndOfPlaybackAction): string {
  return t(END_ACTION_LABELS[action]);
}

export function endOfPlaybackHint(t: TranslateFn, action: EndOfPlaybackAction): string {
  return t(END_ACTION_HINTS[action]);
}

/** "1:23–1:45": a loop's span (times read left to right in every language). */
export function loopSpanLabel(startSeconds: number, endSeconds: number): string {
  return `${formatPlaybackTime(startSeconds)}${String.fromCharCode(0x2013)}${formatPlaybackTime(endSeconds)}`;
}

/** The A-B state in a few characters: "Off", "A 1:23" (B not set yet) or "1:23–1:45". */
export function abPointsLabel(t: TranslateFn, points: AbPoints, durationSeconds: number | null): string {
  const loop = abLoopOf(points, durationSeconds);
  if (loop) {
    return loopSpanLabel(loop.startSeconds, loop.endSeconds);
  }
  if (points.a != null) {
    return `A ${formatPlaybackTime(points.a)}`;
  }
  if (points.b != null) {
    return `B ${formatPlaybackTime(points.b)}`;
  }
  return t('videoPlayer.abRepeatOff');
}
