export {
  clearPersistedBrowserSession,
  flushBrowserSessionPersistence,
  getCachedBrowserSession,
  getPersistedScrollForUrl,
  isRestorableBrowserUrl,
  persistBrowserSession,
  readBrowserSession,
  readBrowserSessionSync,
  resolveRestorableSessionUrl,
  updatePersistedScrollPosition,
} from './session-persistence.service';
export type {
  BrowserSessionSnapshotInput,
  PersistedBrowserSession,
} from './session.types';
export {
  BROWSER_WEBVIEW_INCOGNITO_ENABLED,
  phase6aSessionContinuityPolicy,
  PHASE_6A_THIRD_PARTY_COOKIE_POLICY,
} from './session-continuity-policy';
export type { Phase6aSessionContinuityPolicy } from './session-continuity-policy';
export {
  SENSITIVE_AUTH_QUERY_KEYS,
  stripSensitiveAuthQueryParams,
  urlContainsSensitiveAuthQuery,
} from './session-url-sanitizer';
