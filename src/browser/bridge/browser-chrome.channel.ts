export const BROWSER_CHROME_CHANNEL = 'vidorax-browser-chrome' as const;

export type BrowserChromeMessageType =
  | 'link_long_press'
  | 'scroll'
  | 'pull_to_refresh'
  | 'spa_navigation'
  | 'fullscreen'
  | 'page_links'
  /** B6 #54: the page's auto-scroll loop stopped at the bottom or was paused by a touch. */
  | 'auto_scroll'
  /** B6 #240: whether the page is playing audible media (volume keys keep their job then). */
  | 'media_state'
  /** B7: the page's answer to a find-in-page request (numbers only). */
  | 'find_result'
  /** B13: the page asked for location / camera / microphone / notifications (refused in the page). */
  | 'site_permission'
  /** B13: the page tried to open a window without a tap (not opened). */
  | 'popup_blocked'
  | 'ready';

export type BrowserChromeEnvelope = {
  channel: typeof BROWSER_CHROME_CHANNEL;
  type: BrowserChromeMessageType;
  payload: Record<string, unknown>;
  ts?: number;
};
