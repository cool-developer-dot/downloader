import { dataSaverWantsNoAutoplay, useSaverEffects } from '@/browser/data-saver/data-saver.service';
import { useSettingsStore } from '@/store/settings';

import { normalizeAutoplay, parseAutoplaySites, resolveAutoplay, type AutoplayPolicy } from './blocking-settings';

/**
 * B14 #187 / #218 — the autoplay policy for a page: its site's own choice, else Data saver's "no autoplay" (B18's
 * `dataSaverWantsNoAutoplay` hook → Block all), else the choice for every site. BrowserWebView applies it (WebView's
 * `mediaPlaybackRequiresUserAction` + the Block-all page script); the request guard reloads a page through the browser
 * when the next site's policy differs.
 */

let sitesCache: { raw: string; sites: ReturnType<typeof parseAutoplaySites> } | null = null;

function sitesFrom(raw: string) {
  if (!sitesCache || sitesCache.raw !== raw) sitesCache = { raw, sites: parseAutoplaySites(raw) };
  return sitesCache.sites;
}

export function autoplayPolicyFor(url: string | null | undefined): AutoplayPolicy {
  const s = useSettingsStore.getState();
  return resolveAutoplay(url, normalizeAutoplay(s.autoplay), sitesFrom(s.autoplaySites), dataSaverWantsNoAutoplay());
}

/** The policy for a tab's page; re-renders on the settings and on Data saver. */
export function useAutoplayPolicy(url: string | null | undefined): AutoplayPolicy {
  const global = normalizeAutoplay(useSettingsStore((s) => s.autoplay));
  const raw = useSettingsStore((s) => s.autoplaySites);
  const saverNoAutoplay = useSaverEffects().autoplayOff;
  return resolveAutoplay(url, global, sitesFrom(raw), saverNoAutoplay);
}
