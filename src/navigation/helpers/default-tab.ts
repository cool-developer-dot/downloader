import { routePaths, type RoutePath } from '../constants/route-paths';

/**
 * Default Tab (#474): the tab a returning user lands on after the splash — Browser (default), Downloads or Player
 * (the Library tab). Onboarding and a notification's own link (Downloads or Library) still come first; this only
 * replaces the final fallback. Pure, except for the registered source (`ensureDefaultTab`); with none registered —
 * and in tests — it is Browser, as before.
 */

export type DefaultTab = 'browser' | 'downloads' | 'player';

export const DEFAULT_TABS: readonly DefaultTab[] = ['browser', 'downloads', 'player'];
export const DEFAULT_DEFAULT_TAB: DefaultTab = 'browser';

export function normalizeDefaultTab(raw: unknown): DefaultTab {
  return typeof raw === 'string' && (DEFAULT_TABS as readonly string[]).includes(raw)
    ? (raw as DefaultTab)
    : DEFAULT_DEFAULT_TAB;
}

export function routeForDefaultTab(tab: DefaultTab): RoutePath {
  switch (tab) {
    case 'downloads':
      return routePaths.downloads;
    case 'player':
      return routePaths.library;
    default:
      return routePaths.browser;
  }
}

let source: (() => unknown) | null = null;

export function setDefaultTabSource(next: (() => unknown) | null): void {
  source = next;
}

/** The route the splash falls back to. */
export function defaultTabRoute(): RoutePath {
  let tab: DefaultTab = DEFAULT_DEFAULT_TAB;
  try {
    tab = normalizeDefaultTab(source?.());
  } catch {
    tab = DEFAULT_DEFAULT_TAB;
  }
  return routeForDefaultTab(tab);
}
