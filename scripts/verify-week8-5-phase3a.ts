/**
 * Week 8.5 Phase 3A — About, product identity & app information contracts.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase3a.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { routePaths } from '../src/navigation/constants/route-paths';

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

function readSrc(relFromMobile: string): string {
  return readFileSync(join(ROOT, relFromMobile), 'utf8');
}

const ABOUT_I18N_KEYS = [
  'about.title',
  'about.tagline',
  'about.productDescription',
  'about.version',
  'about.build',
  'about.platform',
  'about.checkForUpdates',
  'about.updateChecking',
  'about.updateOpenedStore',
  'about.updateFailed',
  'about.updateUnavailableDescription',
  'about.rateVidoraX',
  'about.rateUnavailableDescription',
  'about.helpSupport',
  'about.privacyPolicy',
  'about.termsConditions',
  'about.copyrightLine',
  'about.allRightsReserved',
  'about.logoA11y',
  'about.checkForUpdatesA11y',
  'about.rateA11y',
  'about.helpSupportA11y',
  'about.privacyA11y',
  'about.termsA11y',
] as const;

const PLACEHOLDER_PATTERNS = [
  /coming soon/i,
  /future release/i,
  /will be implemented/i,
  /\bTODO\b/,
  /\bplaceholder\b/i,
  /\bdemo\b/i,
  /\bmock\b/i,
];

const SECRET_LEAK_PATTERNS = [
  'apiBaseUrl',
  'api.vidorax.com',
  'EXPO_PUBLIC',
  'JWT',
  'localhost:3105',
  'configuredApiBaseUrl',
];

async function main(): Promise<void> {
  const aboutScreen = readSrc('src/screens/legal/AboutScreen.tsx');
  const aboutRoute = readSrc('src/app/(app)/about.tsx');
  const appIdentity = readSrc('src/constants/app-identity.ts');
  const appJson = readSrc('app.json');
  const storeActions = readSrc(
    'src/screens/legal/about/use-about-store-actions.ts',
  );
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);

  await test('About route exists and wires AboutScreen', () => {
    assert(aboutRoute.includes("from '@/screens/legal'"), 'about route import missing');
    assert(aboutRoute.includes('AboutScreen'), 'AboutScreen not used in route');
    assert(routePaths.about === '/about', `unexpected about path: ${routePaths.about}`);
  });

  await test('Support / Privacy / Terms routes are wired from About', () => {
    assert(aboutScreen.includes('routePaths.support'), 'Support navigation missing');
    assert(aboutScreen.includes('routePaths.privacy'), 'Privacy navigation missing');
    assert(aboutScreen.includes('routePaths.terms'), 'Terms navigation missing');
    assert(routePaths.support === '/support', 'support path');
    assert(routePaths.privacy === '/privacy', 'privacy path');
    assert(routePaths.terms === '/terms', 'terms path');
  });

  await test('Version/build are config-derived, not duplicated hardcoded production values', () => {
    assert(
      aboutScreen.includes('getAppIdentityMetadata'),
      'About must resolve metadata via getAppIdentityMetadata',
    );
    assert(
      !aboutScreen.includes("'1.0.0'"),
      'About must not hardcode version 1.0.0',
    );
    assert(
      !aboutScreen.includes('"1.0.0"'),
      'About must not hardcode version 1.0.0',
    );
    assert(
      appIdentity.includes('Constants.expoConfig'),
      'app-identity must read Expo config',
    );
    assert(
      appIdentity.includes('versionCode') || appIdentity.includes('buildNumber'),
      'app-identity must resolve build from runtime/config',
    );
    assert(appIdentity.includes('cachedMetadata'), 'metadata must be cached once');
    assert(appJson.includes('"version": "1.0.0"'), 'app.json remains source of version');
    assert(appJson.includes('"versionCode": 1'), 'app.json exposes android versionCode');
  });

  await test('Rate action requires valid configured Play Store listing', () => {
    assert(
      storeActions.includes('isPlayStoreListingConfigured'),
      'rate path must gate on listing config',
    );
    assert(
      aboutScreen.includes('rateEnabled'),
      'About UI must gate Rate on rateEnabled',
    );
    assert(
      appIdentity.includes('PLAY_STORE_LISTING_URL'),
      'listing URL must be centralized',
    );
    assert(
      /PLAY_STORE_LISTING_URL:\s*string\s*\|\s*null\s*=\s*null/.test(appIdentity) ||
        /const PLAY_STORE_LISTING_URL[^=]*=\s*null/.test(appIdentity),
      'Play Store listing must remain unset until published',
    );
  });

  await test('Update state is truthful — no fake up-to-date claims', () => {
    assert(!storeActions.includes('up to date'), 'must not claim up to date');
    assert(!storeActions.includes('upToDate'), 'must not claim upToDate');
    assert(!storeActions.includes('update available'), 'must not invent update available');
    assert(storeActions.includes('unavailable'), 'must support unavailable state');
    assert(storeActions.includes('opened_store'), 'must support opened_store state');
    assert(storeActions.includes('checkingRef'), 'must prevent duplicate simultaneous checks');
    assert(
      !aboutScreen.includes('expo-updates'),
      'About must not invent Expo Updates usage',
    );
  });

  await test('Localization keys exist in English + Urdu', () => {
    for (const key of ABOUT_I18N_KEYS) {
      assert(enFlat[key]?.trim().length, `missing EN: ${key}`);
      assert(urFlat[key]?.trim().length, `missing UR: ${key}`);
    }
    assert(
      enFlat['about.productDescription']!.includes('Android'),
      'EN product description should mention Android focus',
    );
    assert(
      !enFlat['about.productDescription']!.toLowerCase().includes('drm bypass'),
      'must not claim DRM bypass',
    );
    assert(
      en.about.copyrightLine.includes('{brand}'),
      'copyright must interpolate brand (VidoraX stays untranslated)',
    );
  });

  await test('No placeholder About copy in production About UI', () => {
    const aboutFiles = [
      aboutScreen,
      readSrc('src/screens/legal/about/AboutIdentityHeader.tsx'),
      readSrc('src/screens/legal/about/AboutCopyright.tsx'),
      readSrc('src/screens/legal/about/use-about-store-actions.ts'),
    ];
    for (const source of aboutFiles) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(source), `placeholder-like copy matched ${pattern}`);
      }
    }
  });

  await test('Theme tokens used — no hardcoded About palette system', () => {
    assert(aboutScreen.includes('useTheme'), 'AboutScreen must use useTheme');
    const identity = readSrc('src/screens/legal/about/AboutIdentityHeader.tsx');
    const row = readSrc('src/screens/legal/about/AboutActionRow.tsx');
    const section = readSrc('src/screens/legal/about/AboutSection.tsx');
    assert(identity.includes('useTheme'), 'identity header theme');
    assert(row.includes('useTheme'), 'action row theme');
    assert(section.includes('useTheme'), 'section theme');
    assert(!aboutScreen.includes('settingsTokens'), 'must not lock to light-only settingsTokens');
  });

  await test('No new About domain store', () => {
    assert(!aboutScreen.includes("from 'zustand'"), 'no zustand in AboutScreen');
    const aboutDir = [
      'src/screens/legal/about/use-about-store-actions.ts',
      'src/screens/legal/about/AboutIdentityHeader.tsx',
      'src/screens/legal/about/AboutActionRow.tsx',
    ];
    for (const rel of aboutDir) {
      const src = readSrc(rel);
      assert(!src.includes("from 'zustand'"), `${rel} must not import zustand`);
      assert(!src.includes('createStore'), `${rel} must not create a store`);
    }
  });

  await test('No production secrets / internal config rendered on About', () => {
    for (const pattern of SECRET_LEAK_PATTERNS) {
      assert(
        !aboutScreen.includes(pattern),
        `AboutScreen must not render/leak ${pattern}`,
      );
    }
    assert(
      !aboutScreen.includes('environment.apiBaseUrl'),
      'must not show API base URL',
    );
  });

  await test('Open-source licenses entry is not a dead route', () => {
    assert(
      !aboutScreen.includes("t('about.openSourceLicenses')"),
      'Open-source licenses row must stay hidden without a useful destination',
    );
  });

  await test('Shared external URL helper is used for store/legal opens', () => {
    assert(
      storeActions.includes('openExternalUrl'),
      'store actions must use openExternalUrl',
    );
    const openHelper = readSrc('src/utils/open-external-url.ts');
    assert(openHelper.includes('canOpenURL'), 'open helper must guard canOpenURL');
    assert(openHelper.includes('catch'), 'open helper must fail gracefully');
  });

  console.log('');
  console.log(`Week 8.5 Phase 3A: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
