import { shouldPersistForTab } from '@/browser/tabs/tab-privacy';

/**
 * B10 #101 — whether a page visit (or a search) may be saved. Pure.
 *
 * - "Save history" off: nothing new is saved; what is there stays.
 * - A tab whose pages aren't kept (`shouldPersistForTab` false — Faran's private tabs) saves nothing.
 * A visit with no known tab (a separate browser window, B20) follows the setting only.
 */
export function shouldSaveVisit(saveHistory: unknown, tab: { id: string } | null | undefined): boolean {
  if (saveHistory === false) return false;
  if (tab != null && !shouldPersistForTab(tab)) return false;
  return true;
}
