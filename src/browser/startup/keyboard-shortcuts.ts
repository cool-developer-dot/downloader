/**
 * B21 #246 — keyboard shortcuts for a physical keyboard, through B6's key channel (`keyCapture.setCombos`). Pure.
 *
 * Combos use the channel's names (`ctrl+shift+tab`, `alt+left`, `f5`, …). They are taken only while the browser is in
 * front; Esc only while something it closes is open (otherwise it stays the page's own key). Dialogs and sheets are
 * windows of their own: their keys are never taken (Android closes them on Esc itself).
 */

export type ShortcutAction =
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'previousTab'
  | 'focusAddressBar'
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'bookmark'
  | 'history'
  | 'closePanel';

export type KeyboardShortcut = {
  action: ShortcutAction;
  /** The channel's combo names that run it. */
  combos: readonly string[];
  /** How the list in Browser settings writes the keys. */
  keys: string;
};

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { action: 'newTab', combos: ['ctrl+t'], keys: 'Ctrl+T' },
  { action: 'closeTab', combos: ['ctrl+w'], keys: 'Ctrl+W' },
  { action: 'reopenTab', combos: ['ctrl+shift+t'], keys: 'Ctrl+Shift+T' },
  { action: 'nextTab', combos: ['ctrl+tab'], keys: 'Ctrl+Tab' },
  { action: 'previousTab', combos: ['ctrl+shift+tab'], keys: 'Ctrl+Shift+Tab' },
  { action: 'focusAddressBar', combos: ['ctrl+l'], keys: 'Ctrl+L' },
  { action: 'reload', combos: ['ctrl+r', 'f5'], keys: 'Ctrl+R / F5' },
  { action: 'hardReload', combos: ['ctrl+shift+r'], keys: 'Ctrl+Shift+R' },
  { action: 'back', combos: ['alt+left'], keys: 'Alt+←' },
  { action: 'forward', combos: ['alt+right'], keys: 'Alt+→' },
  { action: 'bookmark', combos: ['ctrl+d'], keys: 'Ctrl+D' },
  { action: 'history', combos: ['ctrl+h'], keys: 'Ctrl+H' },
  { action: 'closePanel', combos: ['escape'], keys: 'Esc' },
];

const ACTION_BY_COMBO = new Map<string, ShortcutAction>(
  KEYBOARD_SHORTCUTS.flatMap((s) => s.combos.map((combo) => [combo, s.action] as const)),
);

/** The action a captured combo runs, or null. */
export function shortcutActionFor(combo: string): ShortcutAction | null {
  return ACTION_BY_COMBO.get(combo.toLowerCase()) ?? null;
}

/** The combos to take now: none while the browser isn't in front; Esc only while a panel is open. */
export function shortcutCombos(state: { browserInFront: boolean; panelOpen: boolean }): string[] {
  if (!state.browserInFront) return [];
  return KEYBOARD_SHORTCUTS.flatMap((s) => (s.action === 'closePanel' && !state.panelOpen ? [] : s.combos));
}

/** Next / previous tab in the tab order, wrapping around. Null when there is nowhere to go. */
export function cycleTabId(tabIds: readonly string[], activeId: string, delta: 1 | -1): string | null {
  if (tabIds.length < 2) return null;
  const index = tabIds.indexOf(activeId);
  if (index < 0) return tabIds[0];
  return tabIds[(index + delta + tabIds.length) % tabIds.length];
}
