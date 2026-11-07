/**
 * B21 #232 / #233 — the homepage and what opens when the app starts. Pure.
 */

export type StartupOption = 'continue' | 'startPage' | 'homepage';

export const STARTUP_OPTIONS: readonly StartupOption[] = ['continue', 'startPage', 'homepage'];

/** "Continue where you left off" — today's behaviour. */
export const DEFAULT_STARTUP_OPTION: StartupOption = 'continue';

export function normalizeStartupOption(value: unknown): StartupOption {
  return STARTUP_OPTIONS.includes(value as StartupOption) ? (value as StartupOption) : DEFAULT_STARTUP_OPTION;
}

/** The longest homepage address kept (Settings Backup's string cap is 500). */
export const HOMEPAGE_MAX_LENGTH = 500;

/**
 * What the user typed as the homepage, as an address the browser opens: http(s) only (`example.com` becomes
 * `https://example.com/`), no spaces, no user name or password in it. '' (or only spaces) means the start page. Null
 * when it isn't a web address.
 */
export function normalizeHomepageInput(input: string): string | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed) || trimmed.length > HOMEPAGE_MAX_LENGTH) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  const href = url.toString();
  return href.length > HOMEPAGE_MAX_LENGTH ? null : href;
}

/** The stored homepage, re-checked (a restored backup or an old value): '' = the start page. */
export function readHomepage(stored: unknown): string {
  if (typeof stored !== 'string') return '';
  return normalizeHomepageInput(stored) ?? '';
}

export type StartupState = {
  /** The tab in front shows the start page. */
  activeIsStartPage: boolean;
  /** The tab in front shows exactly the homepage. */
  activeIsHomepage: boolean;
  tabCount: number;
  maxTabs: number;
  /** A link from another app opened at this launch: it always wins. */
  openedLaunchLink: boolean;
};

export type StartupPlan =
  | { kind: 'none' }
  /** A new tab in front: the start page (`url` null) or the homepage. Existing tabs stay. */
  | { kind: 'newTab'; url: string | null };

/**
 * What to do once at a cold start, after the tabs are back: nothing for "Continue" (today's), a link from another
 * app, or when the tab in front already shows what the option asks for; otherwise one new tab in front (unless the
 * tab limit is reached — then the tabs are left as they are).
 */
export function planStartup(option: StartupOption, homepage: string, state: StartupState): StartupPlan {
  if (option === 'continue' || state.openedLaunchLink) return { kind: 'none' };
  const url = option === 'homepage' && homepage ? homepage : null;
  if (url == null ? state.activeIsStartPage : state.activeIsHomepage) return { kind: 'none' };
  if (state.tabCount >= state.maxTabs) return { kind: 'none' };
  return { kind: 'newTab', url };
}
