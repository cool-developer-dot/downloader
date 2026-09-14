/**
 * Week 8.5 Phase 2 — Localization & language system contracts.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase2.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSupportedLanguage, normalizeLanguageCode } from '../src/constants/languages';
import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import {
  flattenCatalog,
  humanizeKey,
  type TranslationKey,
} from '../src/localization/types';
import {
  resolveLanguage,
  DEFAULT_APP_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from '../src/localization/config';
import { getRtlLayout } from '../src/localization/rtl';
import {
  bindLanguageReader,
  hasTranslationKey,
  translate,
  translatePlural,
} from '../src/localization/translate';
import { HOME_COPY } from '../src/screens/home/constants/home.constants';
import { initialSettingsState } from '../src/store/settings/state';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (extname(full) === '.ts' || extname(full) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

const TARGET_DIRS = [
  'src/screens/home',
  'src/screens/settings',
  'src/screens/onboarding',
  'src/screens/library',
  'src/screens/downloads',
  'src/screens/player',
  'src/screens/legal',
  'src/app/(app)',
];

const HARDCODED_UI_PATTERNS = [
  'Welcome back',
  'Choose language',
  'Display language for VidoraX',
  'Something went wrong',
  'Try again',
  'Continue watching?',
  'Start Over',
  'Sign Out',
];

async function main(): Promise<void> {
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);
  const enKeys = Object.keys(enFlat).sort();
  const urKeys = Object.keys(urFlat).sort();

  await test('English catalog is complete and non-empty', () => {
    assert(enKeys.length > 200, `expected a production catalog, got ${enKeys.length} keys`);
    for (const key of enKeys) {
      assert(enFlat[key]!.trim().length > 0, `empty English value: ${key}`);
      assert(!enFlat[key]!.includes(key) || key.endsWith('brand'), `English value looks like a raw key: ${key}`);
    }
  });

  await test('Urdu catalog is complete and non-empty', () => {
    assert(urKeys.length > 200, `expected a production catalog, got ${urKeys.length} keys`);
    for (const key of urKeys) {
      assert(urFlat[key]!.trim().length > 0, `empty Urdu value: ${key}`);
    }
  });

  await test('en and ur catalogs have key parity', () => {
    const missingInUr = enKeys.filter((key) => !urKeys.includes(key));
    const extraInUr = urKeys.filter((key) => !enKeys.includes(key));
    assert(missingInUr.length === 0, `missing in ur: ${missingInUr.slice(0, 12).join(', ')}`);
    assert(extraInUr.length === 0, `extra in ur: ${extraInUr.slice(0, 12).join(', ')}`);
  });

  await test('supported languages are only English and Urdu', () => {
    assert(SUPPORTED_LANGUAGES.join(',') === 'en,ur', String(SUPPORTED_LANGUAGES));
    assert(isSupportedLanguage('en'), 'en must be supported');
    assert(isSupportedLanguage('ur'), 'ur must be supported');
    assert(isSupportedLanguage('UR'), 'language codes normalize');
    assert(!isSupportedLanguage('es'), 'Spanish must not be selectable');
    assert(!isSupportedLanguage('fr'), 'French must not be selectable');
    assert(resolveLanguage('es') === 'en', 'unsupported codes fall back to English');
    assert(resolveLanguage('ur-PK') === 'en' || resolveLanguage(normalizeLanguageCode('ur')) === 'ur', 'ur resolves');
    assert(resolveLanguage('ur') === 'ur', 'ur stays ur');
  });

  await test('fallback never returns a raw missing key', () => {
    const missing = 'home.thisKeyDoesNotExist' as TranslationKey;
    const result = translate(missing, undefined, 'ur');
    assert(!result.includes('home.thisKeyDoesNotExist'), `raw key leaked: ${result}`);
    assert(result.length > 0, 'fallback must be readable');
    assert(humanizeKey('home.recentDownloads') === 'Recent Downloads', humanizeKey('home.recentDownloads'));
  });

  await test('Urdu missing key falls back to English', () => {
    const english = translate('home.recentDownloads', undefined, 'en');
    assert(english === 'Recent Downloads', english);
    assert(hasTranslationKey('home.recentDownloads', 'ur'), 'ur must include home.recentDownloads');
    const urdu = translate('home.recentDownloads', undefined, 'ur');
    assert(urdu !== english, 'Urdu recent downloads should differ from English');
    assert(!urdu.includes('home.recentDownloads'), urdu);
  });

  await test('parameter interpolation works in both languages', () => {
    const enGreeting = translate('home.greetingWelcome', undefined, 'en');
    assert(enGreeting === 'Welcome to VidoraX', enGreeting);
    const urGreeting = translate('home.greetingWelcome', undefined, 'ur');
    assert(urGreeting.includes('VidoraX'), urGreeting);
    const version = translate('common.version', { version: '1.0.0' }, 'en');
    assert(version === 'Version 1.0.0', version);
    const urVersion = translate('common.version', { version: '1.0.0' }, 'ur');
    assert(urVersion.includes('1.0.0'), urVersion);
    assert(!urVersion.includes('{version}'), urVersion);
  });

  await test('plural helper covers 0 / 1 / many', () => {
    const zero = translatePlural(0, {
      zero: 'plurals.downloadsZero',
      one: 'plurals.downloadsOne',
      other: 'plurals.downloadsOther',
    }, undefined, 'en');
    const one = translatePlural(1, {
      zero: 'plurals.downloadsZero',
      one: 'plurals.downloadsOne',
      other: 'plurals.downloadsOther',
    }, undefined, 'en');
    const many = translatePlural(3, {
      zero: 'plurals.downloadsZero',
      one: 'plurals.downloadsOne',
      other: 'plurals.downloadsOther',
    }, undefined, 'en');
    assert(zero === 'No downloads', zero);
    assert(one === '1 download', one);
    assert(many === '3 downloads', many);
  });

  await test('RTL helpers are language-driven, not scattered ur checks', () => {
    const ltr = getRtlLayout('en');
    const rtl = getRtlLayout('ur');
    assert(!ltr.isRtl, 'English is LTR');
    assert(ltr.rowDirection === 'row', 'English row');
    assert(ltr.textAlign === 'left', 'English text');
    assert(ltr.arrowBack === 'arrow-left', 'English back');
    assert(rtl.isRtl, 'Urdu is RTL');
    assert(rtl.rowDirection === 'row-reverse', 'Urdu row');
    assert(rtl.textAlign === 'right', 'Urdu text');
    assert(rtl.arrowBack === 'arrow-right', 'Urdu back');
    assert(rtl.chevronForward === 'chevron-left', 'Urdu forward chevron');
    const loc = readRel('src/localization/rtl.ts');
    assert(!loc.includes('forceRTL('), 'must not require app restart via forceRTL');
  });

  await test('language persistence reuses the existing settings store', () => {
    assert(initialSettingsState.language === 'en', 'default language is English');
    const settingsStore = readRel('src/store/settings/index.ts');
    assert(settingsStore.includes('isSupportedLanguage'), 'persist merge must restrict languages');
    assert(settingsStore.includes("name: storageKeys.userPreferences"), 'reuse existing persist key');
    const locIndex = readRel('src/localization/index.ts');
    assert(!locIndex.includes('createStore'), 'localization must not create a second store');
    const hook = readRel('src/localization/use-translation.ts');
    assert(hook.includes('useSyncExternalStore'), 'hook must use React useSyncExternalStore');
    assert(hook.includes('useSettingsStore'), 'hook must reuse settings zustand');
    const provider = readRel('src/localization/provider.tsx');
    assert(provider.includes('LocalizationProvider'), 'LocalizationProvider missing');
    assert(provider.includes('useSyncExternalStore'), 'provider must subscribe via useSyncExternalStore');
    const appProvider = readRel('src/providers/app-provider.tsx');
    assert(appProvider.includes('LocalizationProvider'), 'app must wrap LocalizationProvider');
  });

  await test('Phase 1 Home English copy remains available for frozen verifiers', () => {
    assert(HOME_COPY.noVideosToContinue === 'Nothing playing right now', HOME_COPY.noVideosToContinue);
    assert(HOME_COPY.greetingWelcome === 'Welcome to VidoraX', HOME_COPY.greetingWelcome);
  });

  await test('targeted production files use the localization layer', () => {
    const requiredHints: Record<string, string> = {
      'src/screens/home/HomeScreen.tsx': 'useTranslation',
      'src/screens/settings/SettingsScreen.tsx': 'useTranslation',
      'src/screens/settings/components/GeneralSection.tsx': 'getEnabledLanguages',
      'src/app/(app)/(tabs)/_layout.tsx': "t('nav.home')",
      'src/screens/legal/PrivacyScreen.tsx': "t('privacy.title')",
      'src/screens/legal/TermsScreen.tsx': "t('terms.title')",
      'src/screens/player/components/PlayerControls.tsx': 'useTranslation',
      'src/screens/onboarding/OnboardingScreen.tsx': 'useTranslation',
    };
    for (const [rel, needle] of Object.entries(requiredHints)) {
      const text = readRel(rel);
      assert(text.includes(needle), `${rel} missing ${needle}`);
    }
    const general = readRel('src/screens/settings/components/GeneralSection.tsx');
    assert(!general.includes('Coming Soon'), 'language sheet must not show fake languages');
    assert(general.includes('selected:'), 'selected language must be marked');
  });

  await test('no obvious leftover user-visible English in migrated screens', () => {
    const leftovers: string[] = [];
    for (const dir of TARGET_DIRS) {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) {
        continue;
      }
      const files = collectFiles(abs);
      for (const file of files) {
        if (file.includes('/constants/') || file.endsWith('constants.ts')) {
          continue;
        }
        const text = readFileSync(file, 'utf8');
        const rel = relative(ROOT, file);
        for (const pattern of HARDCODED_UI_PATTERNS) {
          if (text.includes(`'${pattern}'`) || text.includes(`"${pattern}"`)) {
            leftovers.push(`${rel}: ${pattern}`);
          }
        }
      }
    }
    assert(leftovers.length === 0, leftovers.slice(0, 20).join('\n'));
  });

  await test('error mapping stays on the client', () => {
    const errors = readRel('src/localization/errors.ts');
    assert(errors.includes('localizeDownloadErrorCode'), 'download error map missing');
    assert(errors.includes('localizePlayerError'), 'player error map missing');
    assert(errors.includes('localizeApiErrorCode'), 'api error map missing');
    assert(errors.includes('NETWORK_ERROR'), 'NETWORK_ERROR mapping missing');
    assert(
      readRel('src/localization/en.ts').includes('UNSUPPORTED_MEDIA'),
      'UNSUPPORTED_MEDIA mapping missing',
    );
  });

  await test('store-backed language reader switches English to Urdu and back', () => {
    let current = 'en';
    bindLanguageReader(() => current);

    const enHome = translate('nav.home');
    const enSettings = translate('settings.screenTitle');
    assert(enHome === 'Home', enHome);
    assert(enSettings === 'Settings', enSettings);

    current = 'ur';
    const urHome = translate('nav.home');
    const urSettings = translate('settings.screenTitle');
    assert(urHome !== enHome, `Urdu home stayed English: ${urHome}`);
    assert(urHome === 'ہوم', urHome);
    assert(urSettings === 'سیٹنگز', urSettings);
    assert(!urHome.includes('nav.'), urHome);

    current = 'en';
    assert(translate('nav.home') === 'Home', translate('nav.home'));

    current = 'es';
    assert(translate('nav.home') === 'Home', 'unsupported language must fall back to English');

    bindLanguageReader(() => DEFAULT_APP_LANGUAGE);
  });

  await test('Urdu catalog values are not English copies for core domains', () => {
    const samples: TranslationKey[] = [
      'nav.home',
      'common.retry',
      'auth.signInTitle',
      'home.recentDownloads',
      'browser.addressBar',
      'downloads.title',
      'library.title',
      'player.continueWatching',
      'settings.screenTitle',
      'profile.editProfile',
      'support.title',
      'about.title',
      'privacy.title',
      'terms.title',
      'errors.unexpectedTitle',
      'dialogs.confirm',
      'emptyStates.genericTitle',
    ];
    for (const key of samples) {
      const english = translate(key, undefined, 'en');
      const urdu = translate(key, undefined, 'ur');
      assert(urdu !== english, `${key} Urdu is still English: ${urdu}`);
      assert(!urdu.includes(key), `${key} leaked raw key`);
    }
  });

  await test('accessibility translation keys exist for previously hardcoded labels', () => {
    const required: TranslationKey[] = [
      'downloads.actionsA11y',
      'player.seekTimelineA11y',
      'library.favoriteA11y',
      'common.loading',
      'settings.languageSelected',
      'nav.homeTab',
      'browser.hideDetails',
      'history.removeItemA11y',
      'bookmarks.removeItemA11y',
      'favorites.removeItemA11y',
      'downloads.pauseNamedA11y',
    ];
    for (const key of required) {
      assert(hasTranslationKey(key, 'en'), `missing English a11y key ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing Urdu a11y key ${key}`);
    }
    const seek = readRel('src/screens/player/components/PlayerTimeline.tsx');
    assert(seek.includes("t('player.seekTimelineA11y')"), 'seek timeline a11y not localized');
    const actions = readRel('src/screens/downloads/components/DownloadCard.tsx');
    assert(actions.includes("t('downloads.actionsA11y')"), 'download actions a11y not localized');
    const discovery = readRel('src/media-detection/cards/DetectionCard.tsx');
    assert(discovery.includes("t('browser.hideDetails')"), 'detection details a11y not localized');
    const historyItem = readRel('src/screens/history/components/HistoryItem.tsx');
    assert(historyItem.includes("t('history.removeItemA11y'"), 'history remove a11y not localized');
  });

  console.log(`\nWeek 8.5 Phase 2: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
