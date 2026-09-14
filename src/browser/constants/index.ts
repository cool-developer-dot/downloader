export {
  BROWSER_ADDRESS_BAR_HEIGHT,
  BROWSER_ALLOWED_SCHEMES,
  BROWSER_BLOCKED_SCHEMES,
  BROWSER_EXTERNAL_SCHEMES,
  BROWSER_HOMEPAGE,
  BROWSER_INVALID_INPUT_PATTERNS,
  BROWSER_OMNIBOX_FOCUS_DURATION_MS,
  BROWSER_PROGRESS_COMPLETE,
  BROWSER_PROGRESS_FADE_DELAY_MS,
  BROWSER_PROGRESS_FADE_DURATION_MS,
  BROWSER_PROGRESS_HEIGHT,
  BROWSER_PROGRESS_MIN_VISIBLE,
  BROWSER_SEARCH_BASE_URL,
  BROWSER_TOOLBAR_HEIGHT,
  BROWSER_TOUCH_TARGET,
  BROWSER_USER_AGENT_TOKEN,
  BROWSER_SOCIAL_NATIVE_APP_SCHEMES,
  isSocialNativeAppScheme,
  BROWSER_WEBVIEW_BLANK,
} from './browser.constants';

export { BROWSER_CHROME_ACTIONS, getBrowserChromeActions } from './chrome-actions';
export type { BrowserChromeAction } from './chrome-actions';

export { buildBrowserUserAgent, browserUserAgentMode, resolveWebViewUserAgent, resolveWebViewUserAgentForTab } from './user-agent';
export type { BrowserUserAgentMode, BrowserUserAgentOptions } from './user-agent';
