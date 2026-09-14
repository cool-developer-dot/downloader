/**
 * Week 8.5 Final — aggregate product-surface certification.
 * Runs Phase 1 → 2 → 3 → 4 → 5A subverifiers, then Phase 5B freeze/config checks.
 * Pure static / logic. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-final.ts
 *   npm run verify:week8-5-final
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

function runSubVerifier(scriptRel: string, label: string): void {
  const result = spawnSync('npx', ['tsx', join(ROOT, scriptRel)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${label} failed (exit ${result.status})\n${out}`);
  }
  console.log(`  └─ ${label} OK`);
}

const PLACEHOLDER_USER_VISIBLE = [
  /coming soon/i,
  /future release/i,
  /will be implemented/i,
  /main features will be linked here/i,
  /folder selection will arrive/i,
  /loading placeholder/i,
];

async function main(): Promise<void> {
  console.log('Week 8.5 Final — running phase subverifiers…\n');

  await test('Phase 1 Home', () => {
    runSubVerifier('scripts/verify-week8.5-phase1a.ts', 'Phase 1A');
    runSubVerifier('scripts/verify-week8-5-phase1.ts', 'Phase 1B');
  });

  await test('Phase 2 localization', () => {
    runSubVerifier('scripts/verify-week8-5-phase2.ts', 'Phase 2');
  });

  await test('Phase 3 legal/About', () => {
    runSubVerifier('scripts/verify-week8-5-phase3.ts', 'Phase 3');
  });

  await test('Phase 4 Support', () => {
    runSubVerifier('scripts/verify-week8-5-phase4.ts', 'Phase 4');
  });

  await test('Phase 5A Settings completion', () => {
    runSubVerifier('scripts/verify-week8-5-phase5a.ts', 'Phase 5A');
  });

  console.log('\n── Phase 5B certification contracts ──\n');

  const settingsScreen = readSrc('src/screens/settings/SettingsScreen.tsx');
  const settingsTokens = readSrc('src/screens/settings/theme/settings-tokens.ts');
  const profileTokens = readSrc('src/screens/profile/theme/profile-tokens.ts');
  const identity = readSrc('src/constants/app-identity.ts');
  const environment = readSrc('src/constants/environment.ts');
  const diagnostics = readSrc('src/support/diagnostics.ts');
  const freezeDoc = join(ROOT, 'src/WEEK85-PHASE5-FREEZE.md');
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);

  await test('Settings hierarchy remains Phase 5A order', () => {
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
      assert(idx >= 0, `missing ${name}`);
      assert(idx > last, `${name} out of order`);
      last = idx;
    }
  });

  await test('Settings + Profile tokens are theme-aware', () => {
    assert(settingsTokens.includes('useSettingsTokens'), 'useSettingsTokens missing');
    assert(settingsTokens.includes('createSettingsTokens'), 'createSettingsTokens missing');
    assert(settingsTokens.includes('useTheme'), 'Settings tokens must use theme');
    assert(profileTokens.includes('useProfileTokens'), 'useProfileTokens missing');
    assert(profileTokens.includes('createProfileTokens'), 'createProfileTokens missing');
    assert(profileTokens.includes('useTheme'), 'Profile tokens must use theme');
    assert(
      !settingsTokens.includes('light theme only'),
      'Settings must not remain light-only',
    );
    assert(
      !profileTokens.includes('light theme only'),
      'Profile must not remain light-only',
    );
  });

  await test('Navigation contracts for critical Settings destinations', () => {
    assert(routePaths.settings === '/settings', 'settings path');
    assert(routePaths.profile === '/profile', 'profile path');
    assert(routePaths.support === '/support', 'support path');
    assert(routePaths.reportProblem === '/report-problem', 'report path');
    assert(routePaths.privacy === '/privacy', 'privacy path');
    assert(routePaths.terms === '/terms', 'terms path');
    assert(routePaths.about === '/about', 'about path');
    assert(routePaths.downloadSettings === '/download-settings', 'download settings');
    assert(routePaths.library === '/library', 'library path');
  });

  await test('Play Store / support gating remains truthful', () => {
    assert(
      /const PLAY_STORE_LISTING_URL:\s*string\s*\|\s*null\s*=\s*null/.test(identity),
      'Play Store URL must stay null until published',
    );
    assert(
      diagnostics.includes('DIAGNOSTICS_SENSITIVE_KEYS'),
      'diagnostics allowlist required',
    );
  });

  await test('Production API default is environment-driven', () => {
    assert(
      environment.includes("DEFAULT_PROD_API_BASE_URL = 'https://api.vidorax.com'"),
      'prod API default',
    );
    assert(
      !environment.includes("DEFAULT_PROD_API_BASE_URL = 'http://localhost"),
      'prod must not default to localhost',
    );
  });

  await test('No user-visible unfinished copy in core catalogs', () => {
    const keys = [
      'auth.forgotSuccessTitle',
      'common.loadingPlaceholder',
      'profile.changePasswordHint',
      'settings.downloadDirectoryHint',
    ];
    for (const key of keys) {
      assert(hasTranslationKey(key, 'en'), `missing EN ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR ${key}`);
      const enVal = enFlat[key] ?? '';
      const urVal = urFlat[key] ?? '';
      for (const pattern of PLACEHOLDER_USER_VISIBLE) {
        assert(!pattern.test(enVal), `EN ${key} matches ${pattern}`);
        assert(!pattern.test(urVal), `UR ${key} matches ${pattern}`);
      }
    }
  });

  await test('Phase 5 freeze documentation present', () => {
    assert(existsSync(freezeDoc), 'WEEK85-PHASE5-FREEZE.md missing');
    const text = readFileSync(freezeDoc, 'utf8');
    assert(text.includes('Settings hierarchy'), 'freeze doc missing Settings');
    assert(text.includes('Support FAQ'), 'freeze doc missing Support');
    assert(text.includes('localization'), 'freeze doc missing localization');
    assert(text.includes('Home dashboard'), 'freeze doc missing Home');
  });

  console.log(`\nWeek 8.5 Final: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nWeek 8.5 Engineering Complete — Automated Verified');
  console.log('Final Runtime Certification Pending (device matrix not part of this script)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
