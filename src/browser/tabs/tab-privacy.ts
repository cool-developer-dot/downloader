import { isIncognitoTabId } from '../incognito/incognito-state';

/**
 * The one gate for everything the browser saves about a page a tab showed: history, closed tabs, tab snapshots,
 * highlights, notes, page watches and the reading list all ask here first.
 *
 * B11: false for an incognito tab (its id starts with `incog-`); every ordinary tab says yes, as before.
 */
export function shouldPersistForTab(tab: { id: string } | null | undefined): boolean {
  return !isIncognitoTabId(tab?.id);
}
