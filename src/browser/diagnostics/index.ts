export {
  browserRuntimeDiagnosticsContract,
  classifyBrowserLoadError,
  logBrowserError,
  logBrowserHistory,
  logBrowserLoad,
  logBrowserMedia,
  logBrowserNav,
  logBrowserSession,
  logBrowserSsl,
  logBrowserWebView,
  logBrowserWindow,
  logBrowserDesktop,
  safeBrowserHost,
  sanitizeBrowserUrl,
} from './browser-runtime-diagnostics.service';

export type {
  BrowserDiagFields,
  BrowserDiagTag,
  BrowserErrorClassification,
  BrowserLoadPhase,
  BrowserNavEvent,
} from './browser-runtime-diagnostics.service';
