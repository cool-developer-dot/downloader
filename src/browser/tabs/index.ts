export {
  MAX_MOUNTED_WEBVIEWS,
  MAX_OPEN_TABS,
  BROWSER_TABS_SCHEMA_VERSION,
} from './constants';

export { createTabId } from './tab-id';
export {
  createHomeTab,
  createTabFromPersisted,
  homeTabTitle,
  readNewTabDesktopDefault,
  toPersistedTabMetadata,
} from './tab-factory';

export {
  applyMountStates,
  coldStartMountPool,
  reconcileMountPool,
} from './mount-pool';

export {
  __dangerouslyWriteTabEnvelopeForTests,
  __resetTabPersistenceForTests,
  buildFreshTabEngineState,
  clearPersistedTabEngine,
  flushTabEnginePersistence,
  hydrateTabEngineState,
  persistTabEngineState,
  resolveActiveChromeSeed,
} from './tab-persistence.service';

export {
  closeTabOperation,
  createTabOperation,
  selectActiveTab,
  switchTabOperation,
  updateTabOperation,
} from './tab-operations';

export type {
  BrowserTab,
  CloseTabResult,
  CreateTabResult,
  DesktopModeSource,
  PersistedBrowserTabsEnvelope,
  PersistedTabMetadata,
  SwitchTabResult,
  TabEngineSnapshot,
  TabMountState,
} from './types';
