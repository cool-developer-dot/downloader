import type { QueryClient } from '@tanstack/react-query';

export const playbackQueryKeys = {
  root: ['playback'] as const,
  history: (userId: string) => ['playback', 'history', userId] as const,
  recent: (userId: string) => ['playback', 'recent', userId] as const,
  continueWatching: (userId: string) =>
    ['playback', 'continue', userId] as const,
  detail: (userId: string, mediaId: string) =>
    ['playback', 'detail', userId, mediaId] as const,
};

export function invalidatePlaybackUiQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: playbackQueryKeys.root });
}

/** History / Continue Watching / Library must never invalidate on progress ticks. */
export function shouldInvalidatePlaybackQueriesForEvent(
  eventType: 'playbackStarted' | 'positionChanged' | 'paused' | 'completed' | 'playerExited',
): boolean {
  return (
    eventType === 'paused' ||
    eventType === 'completed' ||
    eventType === 'playerExited'
  );
}
