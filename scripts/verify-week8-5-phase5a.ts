/**
 * Week 8.5 Phase 5A — Settings completion, placeholder removal, production surface cleanup.
 * Pure static / logic checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase5a.ts
 *   npm run verify:week8-5-phase5a
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { hasTranslationKey } from '../src/localization/translate';
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

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (
        entry === 'node_modules' ||
        entry === '__tests__' ||
        entry === 'scripts'
      ) {
        continue;
      }
      collectFiles(full, acc);
      continue;
    }
    if (extname(full) === '.ts' || extname(full) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

const SETTINGS_KEYS = [
  'settings.supportSection',
  'settings.accountSectionTitle',
  'settings.storageSection',
  'settings.manageStorage',
  'settings.reportProblem',
  'settings.rateVidoraX',
  'settings.signOutHint',
  'settings.legalSection',
  'auth.forgotSuccessTitle',
  'common.loadingPlaceholder',
] as const;

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /coming soon/i,
  /future release/i,
  /will be implemented/i,
  /main features will be linked here/i,
  /folder selection will arrive/i,
  /(?<![\w.])placeholder(?!\s*=)/i,
];

const PRODUCTION_UI_DIRS = [
  'src/screens/settings',
  'src/screens/support',
  'src/screens/legal',
  'src/screens/home',
  'src/screens/profile',
  'src/app/(app)',
];

const EXCLUDE_FROM_PLACEHOLDER_SCAN = [
  '/constants/',
  'SettingsComingSoonBadge',
  'SettingsRow.tsx',
  'profile-tokens.ts',
  'settings-tokens.ts',
  'StatusBadge',
];

async function main(): Promise<void> {
  const settingsScreen = readSrc('src/screens/settings/SettingsScreen.tsx');
  const aboutSection = readSrc(
    'src/screens/settings/components/AboutSection.tsx',
  );
  const accountSection = readSrc(
    'src/screens/settings/components/AccountSection.tsx',
  );
  const storageSection = readSrc(
    'src/screens/settings/components/StorageSection.tsx',
  );
  const legalSection = readSrc(
    'src/screens/settings/components/LegalSection.tsx',
  );
  const downloadsSection = readSrc(
    'src/screens/settings/components/DownloadsSection.tsx',
  );
  const profileActions = readSrc(
    'src/screens/profile/components/ProfileQuickActions.tsx',
  );
  const forgotSuccess = readSrc(
    'src/screens/auth/components/ForgotPasswordSuccess.tsx',
  );
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);

  console.log('\n── Settings hierarchy ──');

  await test('Settings mounts final section order', () => {
    const order = [
      '<AppearanceSection',
      '<GeneralSection',
      '<DownloadsSection',
      '<StorageSection',
      '<AccountSection',
      '<SupportSection',
      '<LegalSection',
    ];
    let last = -1;
    for (const name of order) {
      const idx = settingsScreen.indexOf(name);
      assert(idx >= 0, `Settings missing ${name}`);
      assert(idx > last, `${name} out of order`);
      last = idx;
    }
    assert(
      !settingsScreen.includes('<SettingsSignOut'),
      'Sign Out must live under AccountSection',
    );
    assert(
      !settingsScreen.includes('<NotificationsSection'),
      'orphan Notifications section must stay off main Settings',
    );
  });

  await test('No Playback section without real playback preferences', () => {
    assert(
      !settingsScreen.includes('PlaybackSection'),
      'PlaybackSection must not appear without real prefs',
    );
  });

  await test('Downloads entry opens real Download Settings', () => {
    assert(
      downloadsSection.includes('routePaths.downloadSettings'),
      'Downloads must navigate to download settings',
    );
    assert(
      !downloadsSection.includes('comingSoon'),
      'Downloads must not use coming-soon rows',
    );
    assert(
      !downloadsSection.includes('downloadDirectory'),
      'Download Location picker must not appear as a dead row',
    );
  });

  await test('Storage → Library is wired', () => {
    assert(storageSection.includes('routePaths.library'), 'Manage Storage → Library');
    assert(storageSection.includes('manageStorage'), 'Manage Storage label key');
  });

  await test('Account → Profile + Sign Out', () => {
    assert(accountSection.includes('routePaths.profile'), 'Account → Profile');
    assert(accountSection.includes('onSignOut'), 'Account exposes Sign Out');
    assert(accountSection.includes('destructive'), 'Sign Out is destructive');
  });

  await test('Support → Help + Report; Rate gated', () => {
    assert(aboutSection.includes('routePaths.support'), 'Support → Help');
    assert(
      aboutSection.includes('routePaths.reportProblem'),
      'Support → Report a Problem',
    );
    assert(
      aboutSection.includes('isPlayStoreListingConfigured'),
      'Rate must gate on Play Store URL',
    );
    assert(
      aboutSection.includes('rateEnabled'),
      'Rate row must be conditionally rendered',
    );
    const identity = readSrc('src/constants/app-identity.ts');
    assert(
      /PLAY_STORE_LISTING_URL:\s*string\s*\|\s*null\s*=\s*null/.test(identity) ||
        /const PLAY_STORE_LISTING_URL:\s*string\s*\|\s*null\s*=\s*null/.test(
          identity,
        ),
      'Play Store URL must stay null until listing exists',
    );
  });

  await test('Legal routes remain complete', () => {
    assert(legalSection.includes('routePaths.privacy'), 'Legal → Privacy');
    assert(legalSection.includes('routePaths.terms'), 'Legal → Terms');
    assert(legalSection.includes('routePaths.about'), 'Legal → About');
    assert(routePaths.privacy === '/privacy', 'privacy path');
    assert(routePaths.terms === '/terms', 'terms path');
    assert(routePaths.about === '/about', 'about path');
    assert(routePaths.support === '/support', 'support path');
    assert(routePaths.reportProblem === '/report-problem', 'report path');
  });

  console.log('\n── Blank / dead routes ──');

  await test('Legal / Support / About / Report routes resolve to screens', () => {
    assert(
      readSrc('src/app/(app)/privacy.tsx').includes('PrivacyScreen'),
      'privacy route',
    );
    assert(
      readSrc('src/app/(app)/terms.tsx').includes('TermsScreen'),
      'terms route',
    );
    assert(
      readSrc('src/app/(app)/about.tsx').includes('AboutScreen'),
      'about route',
    );
    assert(
      readSrc('src/app/(app)/support.tsx').includes('SupportScreen'),
      'support route',
    );
    assert(
      readSrc('src/app/(app)/report-problem.tsx').includes('ReportProblemScreen'),
      'report-problem route',
    );
    assert(
      readSrc('src/app/(app)/profile.tsx').includes('ProfileScreen'),
      'profile route',
    );
    assert(
      readSrc('src/app/(app)/download-settings.tsx').includes(
        'DownloadSettingsScreen',
      ),
      'download-settings route',
    );
  });

  console.log('\n── Placeholder / copy cleanup ──');

  await test('Profile has no Change Password coming-soon row', () => {
    assert(
      !profileActions.includes('change-password'),
      'Change Password coming-soon row must be removed',
    );
    assert(
      !profileActions.includes('comingSoon: true'),
      'Profile quick actions must not ship comingSoon rows',
    );
  });

  await test('Forgot password success copy is truthful', () => {
    assert(
      !forgotSuccess.includes('Coming Soon'),
      'Forgot success UI must not hardcode Coming Soon',
    );
    assert(
      enFlat['auth.forgotSuccessTitle'] !== 'Coming Soon',
      'EN forgotSuccessTitle must not be Coming Soon',
    );
    assert(
      urFlat['auth.forgotSuccessTitle'] !== 'جلد آ رہا ہے',
      'UR forgotSuccessTitle must not be Coming Soon',
    );
    assert(
      /not available/i.test(enFlat['auth.forgotSuccessTitle'] ?? ''),
      'EN forgotSuccessTitle should state unavailable',
    );
  });

  await test('loadingPlaceholder is not developer jargon', () => {
    assert(
      enFlat['common.loadingPlaceholder'] === 'Loading',
      'EN loadingPlaceholder should be Loading',
    );
    assert(
      !/placeholder/i.test(enFlat['common.loadingPlaceholder'] ?? ''),
      'EN loadingPlaceholder must not say placeholder',
    );
  });

  await test('EN/UR keys for Phase 5A settings copy', () => {
    for (const key of SETTINGS_KEYS) {
      assert(hasTranslationKey(key, 'en'), `missing EN ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR ${key}`);
      assert(enFlat[key]?.trim().length, `empty EN ${key}`);
      assert(urFlat[key]?.trim().length, `empty UR ${key}`);
    }
  });

  await test('No production-visible placeholder copy in product surfaces', () => {
    const hits: string[] = [];
    for (const dir of PRODUCTION_UI_DIRS) {
      for (const file of collectFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (EXCLUDE_FROM_PLACEHOLDER_SCAN.some((part) => rel.includes(part))) {
          continue;
        }
        const src = readFileSync(file, 'utf8');
        for (const pattern of PLACEHOLDER_PATTERNS) {
          if (pattern.test(src)) {
            hits.push(`${rel}: ${pattern}`);
          }
        }
      }
    }
    assert(hits.length === 0, `placeholder hits:\n${hits.slice(0, 20).join('\n')}`);
  });

  console.log('\n── Production config sanity ──');

  await test('Production API default is not localhost', () => {
    const envSrc = readSrc('src/constants/environment.ts');
    assert(
      envSrc.includes("DEFAULT_PROD_API_BASE_URL = 'https://api.vidorax.com'"),
      'prod API default missing',
    );
    assert(
      envSrc.includes("DEFAULT_DEV_API_BASE_URL = 'http://localhost:3105'"),
      'dev localhost default may remain behind __DEV__',
    );
    assert(
      envSrc.includes("DEFAULT_PROD_API_BASE_URL = 'https://api.vidorax.com'"),
      'prod default must be https://api.vidorax.com',
    );
    assert(
      !envSrc.includes("DEFAULT_PROD_API_BASE_URL = 'http://localhost"),
      'prod default must not be localhost',
    );
    assert(
      !envSrc.includes("DEFAULT_PROD_API_BASE_URL = 'http://127.0.0.1"),
      'prod default must not be 127.0.0.1',
    );
  });

  await test('Play Store listing remains unset until published', () => {
    const identity = readSrc('src/constants/app-identity.ts');
    assert(
      /const PLAY_STORE_LISTING_URL:\s*string\s*\|\s*null\s*=\s*null/.test(
        identity,
      ),
      'PLAY_STORE_LISTING_URL must stay null until listing exists',
    );
  });

  console.log(`\nPhase 5A: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
