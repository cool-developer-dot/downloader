import type { MediaLibraryItem } from '../library/types';
import type { PlaybackSummary } from './domain/merge';
import { computeProgressPercent } from './domain/progress';

/** Join PlaybackHistory summaries onto Library items by mediaId — no duplicates. */
export function enrichLibraryWithPlayback(
  items: readonly MediaLibraryItem[],
  byMediaId: ReadonlyMap<string, PlaybackSummary>,
): MediaLibraryItem[] {
  if (byMediaId.size === 0) {
    return items.slice();
  }
  return items.map((item) => {
    const summary = byMediaId.get(item.id);
    if (!summary) {
      return item;
    }
    return {
      ...item,
      lastPlayedAt: summary.lastPlayedAt ?? item.lastPlayedAt,
      progressPercent: computeProgressPercent(
        summary.positionSeconds,
        summary.durationSeconds,
      ),
      positionSeconds: summary.positionSeconds,
      completed: summary.completed,
    };
  });
}
