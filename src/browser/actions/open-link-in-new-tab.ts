import type { CreateTabResult } from '@/browser/tabs/types';

/** Only web pages open in a tab: a long-pressed `mailto:` / `tel:` link has no page to load. */
export function canOpenInNewTab(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export type OpenLinkInNewTabPorts = {
  /** `browserStore.createTab`: adds the tab, makes it active and loads the URL (or refuses at the tab limit). */
  createTab: (options: { url: string }) => CreateTabResult;
  /** Tells the user the 10-tab limit was reached; no tab was opened. */
  onLimitReached: () => void;
};

/**
 * "Open in New Tab" from the link menu. The new tab is an ordinary tab: it navigates like any typed URL, so media
 * detection, the offer and downloads work there exactly as in the tab the link came from.
 * Returns null when the link is not a web page.
 */
export function openLinkInNewTab(url: string, ports: OpenLinkInNewTabPorts): CreateTabResult | null {
  if (!canOpenInNewTab(url)) {
    return null;
  }
  const result = ports.createTab({ url: url.trim() });
  if (result.status === 'LIMIT_REACHED') {
    ports.onLimitReached();
  }
  return result;
}
