export const BROWSER_CHROME_CHANNEL = 'vidorax-browser-chrome' as const;

export type BrowserChromeMessageType =
  | 'link_long_press'
  | 'scroll'
  | 'pull_to_refresh'
  | 'spa_navigation'
  | 'ready';

export type BrowserChromeEnvelope = {
  channel: typeof BROWSER_CHROME_CHANNEL;
  type: BrowserChromeMessageType;
  payload: Record<string, unknown>;
  ts?: number;
};
