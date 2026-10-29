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
  | 'ready';

export type BrowserChromeEnvelope = {
  channel: typeof BROWSER_CHROME_CHANNEL;
  type: BrowserChromeMessageType;
  payload: Record<string, unknown>;
  ts?: number;
};
