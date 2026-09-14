import { QueryClient } from '@tanstack/react-query';

import { timeouts } from '@/constants';

/**
 * React Query is used for local playback UI caches only (MMKV-backed).
 * networkMode 'always' avoids gating local reads on connectivity.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: timeouts.queryStaleTime,
      gcTime: timeouts.queryGcTime,
      retry: 1,
      retryDelay: (attemptIndex) => timeouts.queryRetryDelay * attemptIndex,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      networkMode: 'always',
    },
    mutations: {
      retry: 0,
      networkMode: 'always',
    },
  },
});
