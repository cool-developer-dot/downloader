export const timeouts = {
  apiRequest: 30_000,
  debounce: 300,
  toast: 4_000,
  /**
   * Minimum branded splash visibility (JS splash owns this).
   * Bootstrap must NOT block on this — see runAppInitializer.
   */
  splashMinimum: 3_600,
  queryStaleTime: 5 * 60 * 1000,
  queryGcTime: 10 * 60 * 1000,
  queryRetryDelay: 1_000,
} as const;
