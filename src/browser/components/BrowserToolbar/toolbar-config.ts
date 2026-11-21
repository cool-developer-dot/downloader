import type { DsIconName } from '@/design/DsIcon';
import type { TranslateFn, TranslationKey } from '@/localization';

/**
 * Declarative toolbar item registry.
 * Future buttons (downloads, tabs, menu, AI, settings) are added here —
 * BrowserToolbar maps the list without layout rewrites.
 */
export type BrowserToolbarItemId =
  | 'back'
  | 'forward'
  | 'home'
  | 'downloads'
  | 'tabs'
  | 'menu'
  | 'ai'
  | 'settings';

export type BrowserToolbarItem = {
  id: BrowserToolbarItemId;
  /** A Lucide glyph of the design kit. */
  icon: DsIconName;
  accessibilityLabel: string;
  /** When false, the item is omitted from the rendered toolbar. */
  enabled: boolean;
};

export const BROWSER_TOOLBAR_ITEMS: readonly BrowserToolbarItem[] = [
  {
    id: 'back',
    icon: 'arrow-left',
    accessibilityLabel: 'Go back',
    enabled: true,
  },
  {
    id: 'forward',
    icon: 'arrow-right',
    accessibilityLabel: 'Go forward',
    enabled: true,
  },
  {
    id: 'home',
    icon: 'house',
    accessibilityLabel: 'Go home',
    enabled: true,
  },
  // Future phase placeholders — keep disabled until implemented.
  {
    id: 'downloads',
    icon: 'download',
    accessibilityLabel: 'Downloads',
    enabled: false,
  },
  {
    id: 'tabs',
    icon: 'layers',
    accessibilityLabel: 'Tabs',
    enabled: false,
  },
  {
    id: 'menu',
    icon: 'ellipsis-vertical',
    accessibilityLabel: 'Browser menu',
    enabled: false,
  },
  {
    id: 'ai',
    icon: 'sparkles',
    accessibilityLabel: 'AI assistant',
    enabled: false,
  },
  {
    id: 'settings',
    icon: 'settings',
    accessibilityLabel: 'Settings',
    enabled: false,
  },
] as const;

const TOOLBAR_LABEL_KEYS: Record<BrowserToolbarItemId, TranslationKey> = {
  back: 'browser.goBack',
  forward: 'browser.goForward',
  home: 'browser.goHome',
  downloads: 'browser.downloads',
  tabs: 'browser.tabs',
  menu: 'browser.menu',
  ai: 'browser.aiAssistant',
  settings: 'browser.settings',
};

export function getBrowserToolbarItems(t: TranslateFn): BrowserToolbarItem[] {
  return BROWSER_TOOLBAR_ITEMS.map((item) => ({
    ...item,
    accessibilityLabel: t(TOOLBAR_LABEL_KEYS[item.id]),
  }));
}
