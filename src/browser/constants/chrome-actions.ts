import type { IconName } from '@/components/base/Icon';

import type { BrowserChromeActionId } from '@/browser/types';
import type { TranslateFn, TranslationKey } from '@/localization';

/**
 * Future chrome / omnibox actions.
 * Enabled flags stay false until their phase ships — layout consumers can map this list.
 */
export type BrowserChromeAction = {
  id: BrowserChromeActionId;
  icon: IconName;
  accessibilityLabel: string;
  enabled: boolean;
};

export const BROWSER_CHROME_ACTIONS: readonly BrowserChromeAction[] = [
  { id: 'share', icon: 'share-variant', accessibilityLabel: 'Share page', enabled: false },
  {
    id: 'open_external',
    icon: 'open-in-new',
    accessibilityLabel: 'Open in external browser',
    enabled: false,
  },
  { id: 'copy_link', icon: 'content-copy', accessibilityLabel: 'Copy link', enabled: false },
  { id: 'reader_mode', icon: 'book-open-page-variant', accessibilityLabel: 'Reader mode', enabled: false },
  { id: 'translate', icon: 'translate', accessibilityLabel: 'Translate page', enabled: false },
  { id: 'desktop_site', icon: 'monitor', accessibilityLabel: 'Desktop site', enabled: false },
  { id: 'ai_assistant', icon: 'auto-fix', accessibilityLabel: 'AI assistant', enabled: false },
  { id: 'qr_code', icon: 'qrcode', accessibilityLabel: 'Scan QR code', enabled: false },
  { id: 'downloads', icon: 'download', accessibilityLabel: 'Downloads', enabled: false },
  { id: 'bookmarks', icon: 'bookmark-outline', accessibilityLabel: 'Bookmarks', enabled: true },
  { id: 'history', icon: 'history', accessibilityLabel: 'History', enabled: true },
] as const;

const CHROME_LABEL_KEYS: Record<BrowserChromeActionId, TranslationKey> = {
  share: 'browser.sharePage',
  open_external: 'browser.openExternal',
  copy_link: 'browser.copyLink',
  reader_mode: 'browser.readerMode',
  translate: 'browser.translatePage',
  desktop_site: 'browser.desktopSite',
  ai_assistant: 'browser.aiAssistant',
  qr_code: 'browser.qrCode',
  downloads: 'browser.downloads',
  bookmarks: 'browser.bookmarks',
  history: 'browser.history',
};

export function getBrowserChromeActions(t: TranslateFn): BrowserChromeAction[] {
  return BROWSER_CHROME_ACTIONS.map((action) => ({
    ...action,
    accessibilityLabel: t(CHROME_LABEL_KEYS[action.id]),
  }));
}
