/**
 * B21 #238 — which buttons the bottom toolbar shows, in which order. Pure.
 *
 * Stored as a comma-separated list of ids (`toolbarButtons`). Tabs and Menu are not in it: they live in the address
 * bar (as today) and can't be removed. A saved list is read by its known ids — an unknown id (an older or newer app's)
 * and repeats are skipped; an empty or unreadable list falls back to the default (today's Back, Forward, Home).
 */

export type ToolbarButtonId =
  | 'back'
  | 'forward'
  | 'home'
  | 'newTab'
  | 'reload'
  | 'share'
  | 'bookmarks'
  | 'history'
  | 'downloads'
  | 'searchSite';

/** Every button the toolbar can show, in the order offered. */
export const TOOLBAR_BUTTON_IDS: readonly ToolbarButtonId[] = [
  'back',
  'forward',
  'home',
  'newTab',
  'reload',
  'share',
  'bookmarks',
  'history',
  'downloads',
  'searchSite',
];

/** The always-present buttons in the address bar, listed (locked) in Customize toolbar. */
export const LOCKED_TOOLBAR_BUTTONS = ['tabs', 'menu'] as const;

export const DEFAULT_TOOLBAR_BUTTONS: readonly ToolbarButtonId[] = ['back', 'forward', 'home'];
export const DEFAULT_TOOLBAR_BUTTONS_VALUE = DEFAULT_TOOLBAR_BUTTONS.join(',');

/** Six 48 dp buttons fit the narrowest phone (320 dp) with room to spare. */
export const MAX_TOOLBAR_BUTTONS = 6;

export function isToolbarButtonId(value: unknown): value is ToolbarButtonId {
  return TOOLBAR_BUTTON_IDS.includes(value as ToolbarButtonId);
}

export function parseToolbarButtons(stored: unknown): ToolbarButtonId[] {
  if (typeof stored !== 'string') return [...DEFAULT_TOOLBAR_BUTTONS];
  const ids: ToolbarButtonId[] = [];
  for (const raw of stored.split(',')) {
    const id = raw.trim();
    if (isToolbarButtonId(id) && !ids.includes(id) && ids.length < MAX_TOOLBAR_BUTTONS) ids.push(id);
  }
  return ids.length > 0 ? ids : [...DEFAULT_TOOLBAR_BUTTONS];
}

export function serializeToolbarButtons(ids: readonly ToolbarButtonId[]): string {
  return parseToolbarButtons(ids.join(',')).join(',');
}

/** Adds a button at the end (no-op when already shown or the toolbar is full). */
export function addToolbarButton(ids: readonly ToolbarButtonId[], id: ToolbarButtonId): ToolbarButtonId[] {
  if (ids.includes(id) || ids.length >= MAX_TOOLBAR_BUTTONS) return [...ids];
  return [...ids, id];
}

/** Removes a button; the last one can't be removed (the toolbar keeps at least one). */
export function removeToolbarButton(ids: readonly ToolbarButtonId[], id: ToolbarButtonId): ToolbarButtonId[] {
  if (!ids.includes(id) || ids.length <= 1) return [...ids];
  return ids.filter((x) => x !== id);
}

/** Moves a button one place (-1 = earlier, +1 = later); no-op at the ends. */
export function moveToolbarButton(ids: readonly ToolbarButtonId[], id: ToolbarButtonId, delta: -1 | 1): ToolbarButtonId[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
