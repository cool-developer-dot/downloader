/**
 * The one gate for everything the browser saves about a page a tab showed: history, closed tabs, tab snapshots,
 * highlights, notes, page watches and the reading list all ask here first.
 *
 * Every tab is an ordinary tab for now, so it always says yes. Faran's private tabs (B11) make it return false for
 * them — nothing else needs to change then.
 */
export function shouldPersistForTab(_tab: { id: string } | null | undefined): boolean {
  return true;
}
