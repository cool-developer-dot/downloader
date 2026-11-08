/**
 * B18 — Data saver and performance: the settings and the one place that decides what they do together. Pure.
 *
 * - **Block images (#183)**: pictures off on every site except the "always show pictures" list.
 * - **Images on Wi-Fi only (#193)**: pictures off on mobile data (from the next page load).
 * - **Data saver (#184)**: pictures on Wi-Fi only, no preloading (B6), lite mode on mobile data, autoplay off (the
 *   named hook B14 reads: `dataSaverWantsNoAutoplay`).
 * - **Lite mode (#188)**: one live tab (others sleep, B3), page animations off, pictures on Wi-Fi only, the
 *   lightweight start page.
 * - **Hardware acceleration (#189)**: on (default); off = a software layer for each tab from its next load.
 * - **Battery saver (#191)**: Off (default) / Follow the phone's Battery Saver / On: no preloading, slower auto
 *   scroll, tabs sleep after 5 minutes at the latest.
 * - **Cache limit (#192)**: Off (default) / 50 / 100 / 250 / 500 MB, checked at the next start.
 * - **Lightweight start page (#285)**: text only, Quick Access and bookmarks; also whenever lite mode is on.
 */
import { siteKey } from '@/browser/privacy/privacy-settings';

export const BATTERY_SAVER_MODES = ['off', 'phone', 'on'] as const;
export type BatterySaverMode = (typeof BATTERY_SAVER_MODES)[number];
export const DEFAULT_BATTERY_SAVER: BatterySaverMode = 'off';

export const CACHE_LIMITS = ['0', '50', '100', '250', '500'] as const;
export type CacheLimit = (typeof CACHE_LIMITS)[number];
/** '0' = Off (today's). */
export const DEFAULT_CACHE_LIMIT: CacheLimit = '0';

export const MAX_IMAGE_EXCEPTIONS = 200;
export const DEFAULT_IMAGE_EXCEPTIONS_JSON = '[]';

/** Battery saver: an unused tab sleeps after this at the latest. */
export const BATTERY_TAB_SLEEP_MS = 5 * 60_000;
/** Lite mode: every tab but the one in front sleeps at the next check (B3 keeps playing tabs awake). */
export const LITE_TAB_SLEEP_MS = 1;
/** Battery saver: auto scroll at this share of its speed. */
export const BATTERY_AUTO_SCROLL_FACTOR = 0.6;

export function normalizeBatterySaver(value: unknown): BatterySaverMode {
  return typeof value === 'string' && (BATTERY_SAVER_MODES as readonly string[]).includes(value)
    ? (value as BatterySaverMode)
    : DEFAULT_BATTERY_SAVER;
}

export function normalizeCacheLimit(value: unknown): CacheLimit {
  return typeof value === 'string' && (CACHE_LIMITS as readonly string[]).includes(value) ? (value as CacheLimit) : DEFAULT_CACHE_LIMIT;
}

export function cacheLimitBytes(limit: CacheLimit): number {
  return Number(limit) * 1024 * 1024;
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** A typed site ("www.Example.com", "https://example.com/x") as its key, or null. */
export function exceptionSite(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return siteKey(asUrl);
}

export function parseImageExceptions(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const host = item.toLowerCase();
    if (HOSTNAME.test(host) && !out.includes(host)) out.push(host);
    if (out.length >= MAX_IMAGE_EXCEPTIONS) break;
  }
  return out.sort();
}

export function serializeImageExceptions(list: readonly string[]): string {
  return JSON.stringify(parseImageExceptions([...list]));
}

export type SaverSettings = {
  blockImages: boolean;
  imageExceptions: readonly string[];
  imagesWifiOnly: boolean;
  dataSaver: boolean;
  liteMode: boolean;
  lightweightHome: boolean;
  batterySaver: BatterySaverMode;
  hardwareAcceleration: boolean;
};

export type SaverConditions = {
  /** Wi-Fi or Ethernet (the same rule as B9's "Only on Wi-Fi"). */
  onWifi: boolean;
  /** The phone's Battery Saver. */
  phonePowerSave: boolean;
};

export type SaverEffects = {
  dataSaver: boolean;
  lite: boolean;
  battery: boolean;
  /** B6 preloading off. */
  preloadOff: boolean;
  /** The named hook for B14 (autoplay). */
  autoplayOff: boolean;
  /** B3: unused tabs sleep after this at the latest (null = no cap). */
  tabSleepCapMs: number | null;
  /** B6 auto scroll speed share. */
  autoScrollFactor: number;
  /** #189: a software layer for each tab (from its next load). */
  softwareLayer: boolean;
  /** #285 / #188: the text-only start page. */
  lightHome: boolean;
  /** #188: page animations off. */
  pageAnimationsOff: boolean;
  /** #193 / #184 / #188: pictures only on Wi-Fi. */
  imagesWifiOnly: boolean;
};

export function resolveSaverEffects(settings: SaverSettings, conditions: SaverConditions): SaverEffects {
  const battery = settings.batterySaver === 'on' || (settings.batterySaver === 'phone' && conditions.phonePowerSave);
  const lite = settings.liteMode || (settings.dataSaver && !conditions.onWifi);
  return {
    dataSaver: settings.dataSaver,
    lite,
    battery,
    preloadOff: settings.dataSaver || battery || lite,
    autoplayOff: settings.dataSaver,
    tabSleepCapMs: lite ? LITE_TAB_SLEEP_MS : battery ? BATTERY_TAB_SLEEP_MS : null,
    autoScrollFactor: battery ? BATTERY_AUTO_SCROLL_FACTOR : 1,
    softwareLayer: !settings.hardwareAcceleration,
    lightHome: settings.lightweightHome || lite,
    pageAnimationsOff: lite,
    imagesWifiOnly: settings.imagesWifiOnly || settings.dataSaver || settings.liteMode,
  };
}

/** Whether pictures are off for the page at `url`. A site on the "always show pictures" list always shows them. */
export function imagesOffFor(settings: SaverSettings, effects: SaverEffects, conditions: SaverConditions, url: string): boolean {
  const site = siteKey(url);
  if (site && settings.imageExceptions.includes(site)) return false;
  if (settings.blockImages) return true;
  return effects.imagesWifiOnly && !conditions.onWifi;
}

/** B3's sleep time with a saver's cap (`base` null = Sleep unused tabs is off). */
export function cappedTabSleepMs(base: number | null, cap: number | null): number | null {
  if (cap == null) return base;
  return base == null ? cap : Math.min(base, cap);
}

/**
 * Lite mode's page style: animations and transitions over at once (the reduced-motion pattern: 0.01 ms, one
 * iteration, so pages waiting for `transitionend` / `animationend` still get them), no smooth scrolling.
 */
export const LITE_PAGE_CSS =
  '*, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; ' +
  'transition-duration: 0.01ms !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';

export const LITE_PAGE_SCRIPT = `(function () {
  try {
    if (document.getElementById('vidorax-lite')) return;
    var put = function () {
      var root = document.head || document.documentElement;
      if (!root || document.getElementById('vidorax-lite')) return;
      var el = document.createElement('style');
      el.id = 'vidorax-lite';
      el.textContent = ${JSON.stringify(LITE_PAGE_CSS)};
      root.appendChild(el);
    };
    put();
    if (!document.head) document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('vidorax-lite');
      if (el && document.head && el.parentNode !== document.head) document.head.appendChild(el);
      else put();
    }, { once: true });
  } catch (e) {}
})(); true;`;
