import type { IconName } from '@/components/base/Icon';

export type BrowserMenuActionId =
  | 'active_downloads'
  | 'recent_downloads'
  | 'continue_watching'
  | 'recently_watched'
  | 'new_tab'
  | 'add_bookmark'
  | 'bookmarks'
  | 'copy_link'
  | 'share'
  | 'translate'
  | 'history'
  | 'desktop_site'
  | 'open_external'
  | 'downloads'
  | 'settings';

export type BrowserMenuItemKind = 'action' | 'toggle';

export type BrowserMenuItemModel = {
  id: BrowserMenuActionId;
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  kind: BrowserMenuItemKind;
  enabled: boolean;
  /** Toggle row only — current on/off state. */
  toggled?: boolean;
  showDividerBefore?: boolean;
};

export type BrowserOverflowAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserMenuFeedback = {
  message: string;
  tone?: 'success' | 'neutral';
};
