/**
 * B16 — Page display: the global defaults (Browser settings → Page display) and the per-site changes, and what a page
 * actually gets from both. Pure.
 */
import { siteKey } from '@/browser/privacy/privacy-settings';

export const FORCE_DARK_MODES = ['off', 'on', 'app'] as const;
export type ForceDarkMode = (typeof FORCE_DARK_MODES)[number];
/** #163: Off — today's. */
export const DEFAULT_FORCE_DARK: ForceDarkMode = 'off';

export const PAGE_FONT_STYLES = ['default', 'sans', 'serif', 'monospace'] as const;
export type PageFontStyle = (typeof PAGE_FONT_STYLES)[number];
/** #170: the page's own fonts — today's. */
export const DEFAULT_PAGE_FONT_STYLE: PageFontStyle = 'default';

export const COLOR_FILTERS = ['none', 'grayscale', 'protanopia', 'deuteranopia', 'tritanopia'] as const;
export type ColorFilter = (typeof COLOR_FILTERS)[number];
export const DEFAULT_COLOR_FILTER: ColorFilter = 'none';

/** #164: text size in percent (WebView `textZoom`). 100 = today's. */
export const TEXT_ZOOM_MIN = 50;
export const TEXT_ZOOM_MAX = 200;
export const TEXT_ZOOM_STEP = 10;
export const DEFAULT_TEXT_ZOOM = 100;

/** #165: a site's default zoom in percent (WebView initial scale); 0 = the page's own. */
export const PAGE_ZOOM_CHOICES = [0, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;

/** #180: night light strength 10–100 %. */
export const DEFAULT_NIGHT_LIGHT_STRENGTH = 50;

/** #181: page brightness 5–100 %; -1 = the phone's (today's). */
export const BRIGHTNESS_SYSTEM = -1;
export const BRIGHTNESS_MIN = 5;

export const MAX_DISPLAY_SITES = 300;
export const DEFAULT_PAGE_DISPLAY_SITES_JSON = '{}';

function pick<T extends string>(choices: readonly T[], fallback: T) {
  return (value: unknown): T => (typeof value === 'string' && (choices as readonly string[]).includes(value) ? (value as T) : fallback);
}

export const normalizeForceDark = pick(FORCE_DARK_MODES, DEFAULT_FORCE_DARK);
export const normalizePageFontStyle = pick(PAGE_FONT_STYLES, DEFAULT_PAGE_FONT_STYLE);
export const normalizeColorFilter = pick(COLOR_FILTERS, DEFAULT_COLOR_FILTER);

function clampStep(value: unknown, min: number, max: number, step: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

export function normalizeTextZoom(value: unknown): number {
  return clampStep(value, TEXT_ZOOM_MIN, TEXT_ZOOM_MAX, TEXT_ZOOM_STEP, DEFAULT_TEXT_ZOOM);
}

export function normalizeNightLightStrength(value: unknown): number {
  return clampStep(value, 10, 100, 5, DEFAULT_NIGHT_LIGHT_STRENGTH);
}

export function normalizePageBrightness(value: unknown): number {
  if (value === BRIGHTNESS_SYSTEM) return BRIGHTNESS_SYSTEM;
  return typeof value === 'number' && Number.isFinite(value) ? clampStep(value, BRIGHTNESS_MIN, 100, 5, BRIGHTNESS_SYSTEM) : BRIGHTNESS_SYSTEM;
}

export function normalizePageZoom(value: unknown): number {
  return typeof value === 'number' && (PAGE_ZOOM_CHOICES as readonly number[]).includes(value) ? value : 0;
}

/** One site's own changes; a missing field = the global default. */
export type SiteDisplay = {
  /** #164 text size for this site. */
  textZoom?: number;
  /** #165 default zoom for this site (percent; never 0 here). */
  zoom?: number;
  /** #163 "Not on this site": no forced dark here. */
  noForceDark?: true;
};

export type SiteDisplayMap = Readonly<Record<string, SiteDisplay>>;

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

function cleanSite(raw: unknown): SiteDisplay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const site: SiteDisplay = {};
  if (typeof r.textZoom === 'number' && Number.isFinite(r.textZoom)) site.textZoom = normalizeTextZoom(r.textZoom);
  const pageZoom = normalizePageZoom(r.zoom);
  if (pageZoom) site.zoom = pageZoom;
  if (r.noForceDark === true) site.noForceDark = true;
  return Object.keys(site).length ? site : null;
}

export function parseSiteDisplays(raw: unknown): SiteDisplayMap {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, SiteDisplay> = {};
  for (const [host, entry] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_DISPLAY_SITES) break;
    const key = host.toLowerCase();
    if (!HOSTNAME.test(key)) continue;
    const site = cleanSite(entry);
    if (site) out[key] = site;
  }
  return out;
}

export function serializeSiteDisplays(map: SiteDisplayMap): string {
  const keys = Object.keys(map).sort().slice(0, MAX_DISPLAY_SITES);
  const out: Record<string, SiteDisplay> = {};
  for (const key of keys) out[key] = map[key];
  return JSON.stringify(out);
}

/** Changes one site's entry (`undefined` fields are removed); an empty entry goes. */
export function updateSiteDisplay(map: SiteDisplayMap, site: string, change: Partial<Record<keyof SiteDisplay, unknown>>): SiteDisplayMap {
  const merged: Record<string, unknown> = { ...(map[site] ?? {}) };
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const clean = cleanSite(merged);
  const next = { ...map };
  if (clean) next[site] = clean;
  else delete next[site];
  return next;
}

export function resetSiteDisplay(map: SiteDisplayMap, site: string): SiteDisplayMap {
  if (!(site in map)) return map;
  const next = { ...map };
  delete next[site];
  return next;
}

export type PageDisplayGlobals = {
  forceDark: ForceDarkMode;
  textZoom: number;
  forceZoom: boolean;
  textReflow: boolean;
  fontStyle: PageFontStyle;
  urduNastaliq: boolean;
  colorFilter: ColorFilter;
  nightLight: boolean;
  nightLightStrength: number;
};

export type PageDisplay = {
  site: string | null;
  forceDark: boolean;
  textZoom: number;
  /** 0 = the page's own. */
  initialScale: number;
  forceZoom: boolean;
  textReflow: boolean;
  fontStyle: PageFontStyle;
  urduNastaliq: boolean;
  colorFilter: ColorFilter;
  nightLight: boolean;
  nightLightStrength: number;
};

/** What the page at `url` gets: the global defaults with that site's own changes. `appDark` = the app is dark. */
export function resolvePageDisplay(globals: PageDisplayGlobals, sites: SiteDisplayMap, url: string, appDark: boolean): PageDisplay {
  const site = siteKey(url);
  const own = site ? sites[site] : undefined;
  const darkWanted = globals.forceDark === 'on' || (globals.forceDark === 'app' && appDark);
  return {
    site,
    forceDark: darkWanted && !own?.noForceDark,
    textZoom: own?.textZoom ?? globals.textZoom,
    initialScale: own?.zoom ?? 0,
    forceZoom: globals.forceZoom,
    textReflow: globals.textReflow,
    fontStyle: globals.fontStyle,
    urduNastaliq: globals.urduNastaliq,
    colorFilter: globals.colorFilter,
    nightLight: globals.nightLight,
    nightLightStrength: globals.nightLightStrength,
  };
}
