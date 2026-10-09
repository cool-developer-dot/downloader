/**
 * Phase 7 — the browser CTA hands a verified variant to the v2 native DownloadEngine, and Downloads/Library
 * mirror that engine's persisted state. No JavaScript transfer, no second download store.
 */
export {
  pageFavoriteChange,
  removeEngineDownload,
  renameEngineLibraryItem,
  setEngineFavorite,
  retryEngineDownload,
  runEngineDownloadAction,
  type EngineDownloadAction,
  type RetryEngineDownloadInput,
  type RetryEngineDownloadResult,
} from './actions';
export {
  SOURCE_EXPIRED_MESSAGE,
  resolveFreshSourceForEnqueue,
  type ResolveFreshSourceResult,
} from './source-refresh';
export { getV2Engine, setV2EngineForTests, type V2EnginePort } from './engine-port';
export {
  buildV2EnqueueRequest,
  siteIdForPage,
  v2HandoffRejectionMessage,
  type V2EnqueueDecision,
  type V2HandoffInput,
  type V2HandoffRejection,
} from './enqueue-request';
export {
  findExistingDownload,
  handOffVerifiedVariant,
  resetV2HandoffForTests,
  type V2DuplicateOutcome,
  type V2HandoffResult,
} from './handoff';
export {
  applyV2Progress,
  fileQualityLabel,
  projectV2Download,
  projectV2LibraryItem,
  v2FailureMessage,
  type V2DownloadEntry,
} from './projection';
export { collectV2Entries, hydrateV2Downloads, subscribeV2Downloads, type V2BridgeSink } from './bridge';
export {
  ensureV2DownloadBridge,
  ensureV2LibraryHydrated,
  ensureV2LibraryItem,
  reconcileV2Library,
  reconcileV2LibraryIds,
  refreshV2Downloads,
  resetV2DownloadBridgeForTests,
} from './ensure-bridge';
export { createLibraryReconciler, LIBRARY_RECONCILE_TTL_MS, type LibraryReconciler } from './library-reconcile';
export {
  pushV2DownloadSettings,
  resetV2SettingsForTests,
  sameV2Settings,
  v2DownloadSettings,
  type V2SettingsInput,
} from './settings';
export {
  isEngineOwned,
  matchesDownloadsView,
  mergeEngineRowsIntoPage,
  reduceEngineEntries,
  reduceEngineProgress,
  reduceEngineRemoval,
  type EngineViewState,
} from './store-reducer';
export {
  isV2ThumbnailUri,
  isV2LibraryFileUri,
  v2CompletedLibraryFile,
  v2LibraryPlaybackRecord,
  verifyV2LibraryFile,
} from './library-files';
