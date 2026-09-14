/**
 * Playback persistence public surface.
 * Native AppState binder lives in bind-playback-persistence — import that
 * module from app bootstrap only (Node verify safety).
 */

export {
  PLAYBACK_BACKEND_SYNC_INTERVAL_MS,
  PLAYBACK_CLIENT_TIMESTAMP_MAX_FUTURE_MS,
  PLAYBACK_COMPLETED_PROGRESS_PERCENT,
  PLAYBACK_COMPLETED_REMAINING_SECONDS,
  PLAYBACK_HISTORY_PAGE_SIZE,
  PLAYBACK_LOCAL_NAMESPACE,
  PLAYBACK_LOCAL_PERSIST_INTERVAL_MS,
  PLAYBACK_MIN_DURATION_FOR_REMAINING_RULE,
  PLAYBACK_MIN_RESUME_SECONDS,
  PLAYBACK_POSITION_DURATION_TOLERANCE_SECONDS,
  PLAYBACK_RECONNECT_SYNC_BATCH_LIMIT,
  PLAYBACK_REPLAY_RESET_MAX_SECONDS,
  PLAYBACK_STORAGE_KEY_PREFIX,
} from './constants';
export type { PlaybackProgressInput, PlaybackState } from './types';
export {
  clampProgressPercent,
  computeProgressPercent,
  isValidProgressNumbers,
} from './domain/progress';
export { isNearEndComplete, resolveCompletedState } from './domain/completion';
export { isResumeEligible } from './domain/resume';
export { shouldResetCompletedOnReplay } from './domain/replay-reset';
export {
  isContinueWatchingEligible,
  sortByLastPlayedDesc,
} from './domain/continue-watching';
export {
  mergePlaybackStates,
  mergePlaybackSummariesByMediaId,
  localStateToSummary,
  type PlaybackSummary,
} from './domain/merge';
export {
  clampClientTimestampIso,
  reconcilePlaybackState,
  shouldPushLocalAfterReconcile,
  type ReconcileDecision,
  type ReconcilePlaybackResult,
} from './domain/reconcile';
export {
  formatLastPlayedLabel,
  formatProgressPercentLabel,
  formatRemainingLabel,
  formatResumeLabel,
  formatPlaybackTime,
} from './domain/format';
export {
  clearMemoryPlaybackStorage,
  configurePlaybackStorageAdapter,
  deletePlaybackState,
  isLocalPlaybackNamespace,
  listLocalPlaybackStates,
  listPlaybackStatesForUser,
  loadPlaybackState,
  migratePlaybackKeysToLocalNamespace,
  parsePlaybackStorageKey,
  playbackStorageKey,
  resetPlaybackStorageForTests,
  savePlaybackState,
  type PlaybackNamespaceMigrationResult,
  type PlaybackStorageAdapter,
} from './persistence';
export {
  PlaybackPersistenceCoordinator,
  type PlaybackBoundaryReason,
  type PlaybackCoordinatorClock,
  type PlaybackCoordinatorDeps,
  type PlaybackSyncTransport,
} from './coordinator';
export { playbackLog, type PlaybackDiagnosticEvent } from './diagnostics';
export { enrichLibraryWithPlayback } from './enrich-library';
export { playbackQueryKeys, invalidatePlaybackUiQueries, shouldInvalidatePlaybackQueriesForEvent } from './query-keys';
