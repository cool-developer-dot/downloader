/**
 * B8 — the app's items in a page's text-selection menu, in menu order. Android's own items stay in the menu: Copy
 * (#73: clipboard) and Share (#74: Android's share sheet), Paste, Select all, and text-processing apps. Chromium's
 * "Web search" is replaced by the app's Search, which uses the engine chosen in Browser settings.
 *
 * To add an item (B22 "Save to notes", B23 "Highlight"): add an entry here with its catalog key, and a handler for its
 * id in `selection-menu.service.ts`. Ids follow the native rule `[a-z][A-Za-z0-9_]{0,31}`; at most 4 items.
 */

export type SelectionMenuItemId = 'search' | 'save_note';

export type SelectionMenuItemDefinition = {
  id: SelectionMenuItemId;
  /** Catalog key of the item's title (shown as is in the menu; 40 characters at most). */
  labelKey: 'browserSelection.search' | 'browserShare.saveToNotes';
};

export const SELECTION_MENU_ITEMS: readonly SelectionMenuItemDefinition[] = [
  { id: 'search', labelKey: 'browserSelection.search' },
  // B22 #252
  { id: 'save_note', labelKey: 'browserShare.saveToNotes' },
];

/** Native caps (SelectionMenu.kt). */
export const SELECTION_MENU_MAX_ITEMS = 4;
export const SELECTION_MENU_MAX_TITLE = 40;

/**
 * The ids and translated titles for `VidoraWeb.setSelectionMenu`, in order. A title is trimmed and cut to 40
 * characters; an item whose title is empty is left out (a missing translation never shows an empty item).
 */
export function buildSelectionMenu(
  items: readonly SelectionMenuItemDefinition[],
  translate: (key: SelectionMenuItemDefinition['labelKey']) => string,
): { ids: string[]; titles: string[] } {
  const ids: string[] = [];
  const titles: string[] = [];
  for (const item of items) {
    if (ids.length >= SELECTION_MENU_MAX_ITEMS) break;
    const title = translate(item.labelKey).trim().slice(0, SELECTION_MENU_MAX_TITLE).trim();
    if (!title || ids.includes(item.id)) continue;
    ids.push(item.id);
    titles.push(title);
  }
  return { ids, titles };
}
