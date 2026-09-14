import type { IconName } from '@/components/base/Icon';

/**
 * Context provided to long-press (and future) browser actions.
 * Actions never touch WebView refs directly — they use callbacks / services.
 */
export type BrowserActionContext = {
  url: string;
  title?: string;
  linkText?: string;
  pageUrl?: string;
  /** Reserved for future tab orchestration — no-op in Phase 1 Day 4. */
  openInNewTab?: (url: string) => void;
};

export type BrowserActionId =
  | 'copy_link'
  | 'share_link'
  | 'open_in_new_tab'
  | 'open_external'
  | (string & {});

export type BrowserLongPressAction = {
  id: BrowserActionId;
  label: string;
  icon?: IconName;
  /** Sort ascending — lower runs first in the sheet. */
  order: number;
  destructive?: boolean;
  /**
   * When false, the action is listed but disabled (architecture placeholder).
   * Default true.
   */
  enabled?: boolean;
  /**
   * Optional predicate — return false to hide for a given context.
   * Defaults to always visible.
   */
  isAvailable?: (context: BrowserActionContext) => boolean;
  execute: (context: BrowserActionContext) => void | Promise<void>;
};

export type BrowserLinkLongPressPayload = {
  href: string;
  text: string;
  x: number;
  y: number;
  pageUrl: string;
};
