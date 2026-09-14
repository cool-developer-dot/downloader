import { useQuery, type QueryClient } from '@tanstack/react-query';

import { PLAYBACK_LOCAL_NAMESPACE } from './constants';
import {
  isContinueWatchingEligible,
  sortByLastPlayedDesc,
} from './domain/continue-watching';
import {
  localStateToSummary,
  mergePlaybackStates,
  type PlaybackSummary,
} from './domain/merge';
import { listPlaybackStatesForUser, loadPlaybackState } from './persistence';
import { playbackQueryKeys } from './query-keys';

/** Local playback summaries for this device. */
export function listLocalPlaybackSummaries(
  namespace: string = PLAYBACK_LOCAL_NAMESPACE,
): PlaybackSummary[] {
  if (!namespace) {
    return [];
  }
  return listPlaybackStatesForUser(namespace).map(localStateToSummary);
}

export function resolvePlaybackSummary(
  mediaId: string,
  remote: PlaybackSummary | null = null,
): PlaybackSummary | null {
  if (!mediaId) {
    return remote;
  }
  const local = loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, mediaId);
  return mergePlaybackStates(local, remote);
}

export function usePlaybackDetail(mediaId: string | null) {
  const query = useQuery({
    queryKey: playbackQueryKeys.detail(PLAYBACK_LOCAL_NAMESPACE, mediaId ?? ''),
    queryFn: async () => {
      if (!mediaId) {
        return null;
      }
      return resolvePlaybackSummary(mediaId, null);
    },
    enabled: Boolean(mediaId),
    staleTime: 5_000,
    retry: 0,
  });

  return {
    summary: query.data ?? null,
    isLoading: query.isLoading && !query.data,
    isError: false,
    refetch: query.refetch,
  };
}

export function useContinueWatchingQuery() {
  const query = useQuery({
    queryKey: playbackQueryKeys.continueWatching(PLAYBACK_LOCAL_NAMESPACE),
    queryFn: async (): Promise<PlaybackSummary[]> => {
      return sortByLastPlayedDesc(
        listLocalPlaybackSummaries().filter((s) => isContinueWatchingEligible(s)),
      );
    },
    staleTime: 5_000,
    retry: 0,
  });

  const items = query.data ?? [];

  return {
    items,
    isLoading: query.isLoading && items.length === 0,
    isError: false,
    refetch: query.refetch,
    isOfflineFallback: false,
  };
}

export function useRecentPlaybackQuery(limit = 20) {
  const query = useQuery({
    queryKey: playbackQueryKeys.recent(PLAYBACK_LOCAL_NAMESPACE),
    queryFn: async (): Promise<PlaybackSummary[]> => {
      const local = listLocalPlaybackSummaries().filter(
        (s) => s.lastPlayedAt != null,
      );
      return sortByLastPlayedDesc(local).slice(0, Math.max(0, limit));
    },
    staleTime: 5_000,
    retry: 0,
  });

  const items = query.data ?? [];

  return {
    items,
    isLoading: query.isLoading && items.length === 0,
    refetch: query.refetch,
  };
}

export function usePlaybackHistoryInfiniteQuery() {
  const query = useQuery({
    queryKey: playbackQueryKeys.history(PLAYBACK_LOCAL_NAMESPACE),
    queryFn: async () => {
      const local = listLocalPlaybackSummaries().filter(
        (s) => s.lastPlayedAt != null,
      );
      return sortByLastPlayedDesc(local);
    },
    staleTime: 5_000,
    retry: 0,
  });

  const items = query.data ?? [];

  return {
    items,
    isLoading: query.isLoading && items.length === 0,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: async () => undefined,
    isError: false,
    refetch: query.refetch,
    isOfflineFallback: false,
  };
}

export function buildPlaybackSummaryMap(
  summaries: readonly PlaybackSummary[],
): Map<string, PlaybackSummary> {
  const map = new Map<string, PlaybackSummary>();
  for (const s of summaries) {
    map.set(s.mediaId, s);
  }
  return map;
}

export type { QueryClient };
