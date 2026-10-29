/**
 * B5 — the search engines the browser can use, and the one place every search URL is built (`getSearchEngine()`):
 * the address bar, search suggestions, selected text (B8), search shortcuts (B4) and the search widget (B24).
 * Pure: the user's choices come in through `bindSearchSettingsReader` (bound by the settings store), so the URL
 * builder runs under Node in `search-engines.test.ts`.
 *
 * Each engine names its own Safe Search, language and region parameters. Where an engine has no such parameter (or
 * no level in between), the nearest behaviour is used and the settings screen says so (`support`).
 */

export type SearchEngineId = 'google' | 'bing' | 'duckduckgo' | 'yahoo' | 'ecosia' | 'brave';
export type SafeSearchLevel = 'off' | 'moderate' | 'strict';
/** `default`: the engine decides (no parameter — today's behaviour); `app`: the app's language. */
export type SearchLanguage =
  | 'default'
  | 'app'
  | 'en'
  | 'ur'
  | 'ar'
  | 'hi'
  | 'fa'
  | 'bn'
  | 'tr'
  | 'fr'
  | 'de'
  | 'es'
  | 'zh';
/** `auto`: the engine decides (no parameter — today's behaviour). Others are ISO 3166 country codes. */
export type SearchRegion = 'auto' | 'pk' | 'in' | 'ae' | 'sa' | 'bd' | 'gb' | 'us' | 'ca' | 'au' | 'de' | 'tr';

export const SEARCH_ENGINE_IDS: readonly SearchEngineId[] = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];
export const SAFE_SEARCH_LEVELS: readonly SafeSearchLevel[] = ['off', 'moderate', 'strict'];
export const SEARCH_LANGUAGES: readonly SearchLanguage[] = [
  'default',
  'app',
  'en',
  'ur',
  'ar',
  'hi',
  'fa',
  'bn',
  'tr',
  'fr',
  'de',
  'es',
  'zh',
];
export const SEARCH_REGIONS: readonly SearchRegion[] = [
  'auto',
  'pk',
  'in',
  'ae',
  'sa',
  'bd',
  'gb',
  'us',
  'ca',
  'au',
  'de',
  'tr',
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google';
/** Moderate adds no parameter for Google, so the default search URL is exactly today's. */
export const DEFAULT_SAFE_SEARCH: SafeSearchLevel = 'moderate';
export const DEFAULT_SEARCH_LANGUAGE: SearchLanguage = 'default';
export const DEFAULT_SEARCH_REGION: SearchRegion = 'auto';

export type SearchSettings = {
  engine: SearchEngineId;
  safeSearch: SafeSearchLevel;
  language: SearchLanguage;
  region: SearchRegion;
  /** The app's language, for `language: 'app'`. */
  appLanguage: string;
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  engine: DEFAULT_SEARCH_ENGINE,
  safeSearch: DEFAULT_SAFE_SEARCH,
  language: DEFAULT_SEARCH_LANGUAGE,
  region: DEFAULT_SEARCH_REGION,
  appLanguage: 'en',
};

/** How much of a setting an engine can apply from the link alone. */
export type SettingSupport = 'full' | 'nearest' | 'none';

export type SearchEngineDefinition = {
  id: SearchEngineId;
  name: string;
  /** A bundled letter badge in the engine's colour — no remote icon, no brand asset. */
  badge: { letter: string; color: string };
  /** Where results live; also how a results page is recognized (`searchQueryFromUrl`). */
  origin: string;
  path: string;
  queryParam: string;
  support: { safeSearch: SettingSupport; language: SettingSupport; region: SettingSupport };
  safeParams: (level: SafeSearchLevel) => [string, string][];
  languageParams: (language: string) => [string, string][];
  regionParams: (region: Exclude<SearchRegion, 'auto'>, language: string | null) => [string, string][];
  /** A region served from its own host instead of a parameter (Yahoo). */
  regionOrigin?: (region: Exclude<SearchRegion, 'auto'>) => string | null;
};

/** DuckDuckGo regions are `<country>-<language>` pairs. */
const DDG_REGIONS: Readonly<Record<Exclude<SearchRegion, 'auto'>, string>> = {
  pk: 'pk-en',
  in: 'in-en',
  ae: 'xa-ar',
  sa: 'xa-ar',
  bd: 'wt-wt',
  gb: 'uk-en',
  us: 'us-en',
  ca: 'ca-en',
  au: 'au-en',
  de: 'de-de',
  tr: 'tr-tr',
};

/** DuckDuckGo interface languages (`kad`); one it lacks falls back to English. */
const DDG_LANGUAGES: Readonly<Record<string, string>> = {
  en: 'en_US',
  ar: 'ar_EG',
  hi: 'hi_IN',
  fa: 'fa_IR',
  bn: 'bn_BD',
  tr: 'tr_TR',
  fr: 'fr_FR',
  de: 'de_DE',
  es: 'es_ES',
  zh: 'zh_CN',
};

/** Yahoo's country sites; Pakistan, the UAE, Saudi Arabia and Bangladesh have none (the global site is used). */
const YAHOO_REGION_HOSTS: Readonly<Partial<Record<Exclude<SearchRegion, 'auto'>, string>>> = {
  in: 'https://in.search.yahoo.com',
  gb: 'https://uk.search.yahoo.com',
  ca: 'https://ca.search.yahoo.com',
  au: 'https://au.search.yahoo.com',
  de: 'https://de.search.yahoo.com',
};

export const SEARCH_ENGINES: Readonly<Record<SearchEngineId, SearchEngineDefinition>> = {
  google: {
    id: 'google',
    name: 'Google',
    badge: { letter: 'G', color: '#4285F4' },
    origin: 'https://www.google.com',
    path: '/search',
    queryParam: 'q',
    // Google has Off / Blur (its default) / Filter: Moderate = Blur, i.e. no parameter.
    support: { safeSearch: 'nearest', language: 'full', region: 'full' },
    safeParams: (level) => (level === 'strict' ? [['safe', 'active']] : level === 'off' ? [['safe', 'off']] : []),
    languageParams: (language) => [['hl', language]],
    regionParams: (region) => [['gl', region.toUpperCase()]],
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    badge: { letter: 'B', color: '#008373' },
    origin: 'https://www.bing.com',
    path: '/search',
    queryParam: 'q',
    support: { safeSearch: 'full', language: 'full', region: 'full' },
    safeParams: (level) => [['adlt', level]],
    languageParams: (language) => [['setlang', language]],
    regionParams: (region) => [['cc', region.toUpperCase()]],
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    badge: { letter: 'D', color: '#DE5833' },
    origin: 'https://duckduckgo.com',
    path: '/',
    queryParam: 'q',
    // No Urdu interface: Urdu falls back to English (nearest).
    support: { safeSearch: 'full', language: 'nearest', region: 'nearest' },
    safeParams: (level) => [['kp', level === 'strict' ? '1' : level === 'moderate' ? '-1' : '-2']],
    languageParams: (language) => [['kad', DDG_LANGUAGES[language] ?? 'en_US']],
    regionParams: (region) => [['kl', DDG_REGIONS[region]]],
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo',
    badge: { letter: 'Y', color: '#6001D2' },
    origin: 'https://search.yahoo.com',
    path: '/search',
    queryParam: 'p',
    // `vl` keeps results in one language (Yahoo has no interface-language parameter); regions are country sites.
    support: { safeSearch: 'full', language: 'nearest', region: 'nearest' },
    safeParams: (level) => [['vm', level === 'strict' ? 'r' : level === 'moderate' ? 'i' : 'p']],
    languageParams: (language) => [
      ['vl', `lang_${language}`],
      ['fl', '1'],
    ],
    regionParams: () => [],
    regionOrigin: (region) => YAHOO_REGION_HOSTS[region] ?? null,
  },
  ecosia: {
    id: 'ecosia',
    name: 'Ecosia',
    badge: { letter: 'E', color: '#36ACB8' },
    origin: 'https://www.ecosia.org',
    path: '/search',
    queryParam: 'q',
    // Ecosia keeps Safe Search, language and region in its own settings (a cookie), not in the link.
    support: { safeSearch: 'none', language: 'none', region: 'none' },
    safeParams: () => [],
    languageParams: () => [],
    regionParams: () => [],
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    badge: { letter: 'Br', color: '#FB542B' },
    origin: 'https://search.brave.com',
    path: '/search',
    queryParam: 'q',
    support: { safeSearch: 'full', language: 'full', region: 'full' },
    safeParams: (level) => [['safesearch', level]],
    languageParams: (language) => [['ui_lang', language]],
    regionParams: (region) => [['country', region]],
  },
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeSearchEngineId(value: unknown): SearchEngineId {
  return oneOf(value, SEARCH_ENGINE_IDS, DEFAULT_SEARCH_ENGINE);
}
export function normalizeSafeSearch(value: unknown): SafeSearchLevel {
  return oneOf(value, SAFE_SEARCH_LEVELS, DEFAULT_SAFE_SEARCH);
}
export function normalizeSearchLanguage(value: unknown): SearchLanguage {
  return oneOf(value, SEARCH_LANGUAGES, DEFAULT_SEARCH_LANGUAGE);
}
export function normalizeSearchRegion(value: unknown): SearchRegion {
  return oneOf(value, SEARCH_REGIONS, DEFAULT_SEARCH_REGION);
}

/** The language code sent for a choice: `default` → none; `app` → the app's (supported) language. */
export function resolveSearchLanguage(language: SearchLanguage, appLanguage: string): string | null {
  if (language === 'default') return null;
  if (language === 'app') {
    const code = appLanguage.toLowerCase().split(/[-_]/)[0] ?? '';
    return /^[a-z]{2}$/.test(code) ? code : null;
  }
  return language;
}

/** Collapses whitespace the way a search box does; keeps operators such as `site:` as typed. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** The results URL for `query` on `settings.engine`, with the chosen Safe Search, language and region. */
export function buildEngineSearchUrl(query: string, settings: SearchSettings): string {
  const engine = SEARCH_ENGINES[normalizeSearchEngineId(settings.engine)];
  const region = normalizeSearchRegion(settings.region);
  const language = resolveSearchLanguage(normalizeSearchLanguage(settings.language), settings.appLanguage);
  const origin = (region !== 'auto' && engine.regionOrigin?.(region)) || engine.origin;
  const url = new URL(engine.path, origin);
  url.searchParams.set(engine.queryParam, normalizeSearchQuery(query));
  const params: [string, string][] = [
    ...engine.safeParams(normalizeSafeSearch(settings.safeSearch)),
    ...(language ? engine.languageParams(language) : []),
    ...(region !== 'auto' ? engine.regionParams(region, language) : []),
  ];
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Google's Moderate is its default, so a Google search with default settings is exactly the URL the app always
 * built: `https://www.google.com/search?q=…`.
 */
export function isDefaultSearchUrl(url: string): boolean {
  return /^https:\/\/www\.google\.com\/search\?q=[^&]*$/.test(url);
}

/** The query of a results page of any known engine (for recent searches, the address bar), else null. */
export function searchQueryFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const engine of Object.values(SEARCH_ENGINES)) {
    const host = new URL(engine.origin).host;
    const sameHost =
      parsed.host === host ||
      (engine.id === 'yahoo' && /(^|\.)search\.yahoo\.com$/.test(parsed.host));
    if (sameHost && parsed.pathname === engine.path) {
      const query = parsed.searchParams.get(engine.queryParam);
      return query && query.trim() ? query : null;
    }
  }
  return null;
}

type SettingsReader = () => SearchSettings;
let readSettings: SettingsReader = () => DEFAULT_SEARCH_SETTINGS;

/** The settings store binds itself here at startup (like `bindLanguageReader`). */
export function bindSearchSettingsReader(reader: SettingsReader): void {
  readSettings = reader;
}

export type ActiveSearchEngine = SearchEngineDefinition & {
  settings: SearchSettings;
  buildSearchUrl: (query: string) => string;
};

/**
 * The search engine every search goes through, with the user's current settings. Callers that need another engine
 * (Faran's private tabs may choose their own) pass `override`.
 */
export function getSearchEngine(override?: Partial<SearchSettings>): ActiveSearchEngine {
  const settings = { ...readSettings(), ...override };
  const definition = SEARCH_ENGINES[normalizeSearchEngineId(settings.engine)];
  return {
    ...definition,
    settings,
    buildSearchUrl: (query: string) => buildEngineSearchUrl(query, settings),
  };
}
