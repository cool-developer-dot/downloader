/**
 * Local-Only Migration Final — aggregate essential certification contracts.
 * Reuses existing verifiers. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-local-only-final.ts
 *   npm run verify:local-only-final
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function runNpm(script: string): void {
  const result = spawnSync('npm', ['run', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${script} failed (exit ${result.status})\n${out.slice(-4000)}`);
  }
  console.log(`  └─ ${script} OK`);
}

const SUBSUITES = [
  'verify:phase1-local-core',
  'verify:phase2-local-identity',
  'verify:phase3a-no-backend-runtime',
  'verify:critical-download-flows',
  'verify:library-completion-sync',
  'verify:resume-regressions',
  'verify:playback-sync-final',
  'verify:download-settings',
  'verify:linking-mount',
  'verify:week8-5-phase2',
  'verify:week8-5-phase3b1',
  'verify:week8-5-phase3b2',
  'verify:week8-5-phase4',
] as const;

console.log('Local-Only Migration Final — aggregate certification\n');

test('TypeScript compile (tsc --noEmit)', () => {
  const result = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stdout || result.stderr || 'tsc failed').slice(-4000));
  }
  console.log('  └─ tsc OK');
});

for (const script of SUBSUITES) {
  test(script, () => {
    runNpm(script);
  });
}

console.log('\n── Phase 3B freeze / architecture contracts ──\n');

test('Settings hierarchy is local-only (no Account / Sign Out)', () => {
  const screen = read('src/screens/settings/SettingsScreen.tsx');
  const order = [
    '<AppearanceSection',
    '<GeneralSection',
    '<DownloadsSection',
    '<StorageSection',
    '<SupportSection',
    '<LegalSection',
  ];
  let last = -1;
  for (const name of order) {
    const idx = screen.indexOf(name);
    assert(idx >= 0, `missing ${name}`);
    assert(idx > last, `${name} out of order`);
    last = idx;
  }
  assert(!screen.includes('AccountSection'), 'Account section must stay removed');
  assert(!screen.includes('SettingsSignOut'), 'Sign out must stay removed');
  assert(!screen.includes('PlaybackSection'), 'no empty Playback section');
});

test('Auth-free navigation contracts', () => {
  assert(routePaths.home === '/', 'home path');
  assert(routePaths.splash.length > 0, 'splash');
  assert(routePaths.onboarding.length > 0, 'onboarding');
  assert(routePaths.support === '/support', 'support');
  assert(routePaths.reportProblem === '/report-problem', 'report');
  assert(routePaths.privacy === '/privacy', 'privacy');
  assert(routePaths.terms === '/terms', 'terms');
  assert(routePaths.about === '/about', 'about');
  const paths = read('src/navigation/constants/route-paths.ts');
  assert(!paths.includes('signIn'), 'no signIn');
  assert(!paths.includes('signUp'), 'no signUp');
  assert(!/profile:/.test(paths), 'no profile route');
});

test('No required VidoraX backend configuration', () => {
  const env = read('src/constants/environment.ts');
  assert(!env.includes('API_BASE_URL'), 'no API_BASE_URL');
  assert(!env.includes('api.vidorax.com'), 'no api.vidorax.com');
  assert(!env.includes('/health'), 'no health');
  const example = read('.env.example');
  assert(
    !/^\s*EXPO_PUBLIC_API_BASE_URL\s*=/m.test(example),
    '.env.example must not assign API base URL',
  );
  assert(
    /local-first|does not require|do not configure a vidorax backend/i.test(example),
    'documents local-first',
  );
  assert(!existsSync(join(ROOT, 'src/api/axios.ts')), 'axios client gone');
  assert(!existsSync(join(ROOT, 'src/realtime')), 'realtime gone');
});

test('Local authority surfaces remain wired', () => {
  assert(existsSync(join(ROOT, 'src/downloads/analyze/analyze-url.ts')), 'local analyzer');
  assert(existsSync(join(ROOT, 'src/storage/repositories/download-catalog.repository.ts')), 'catalog');
  assert(existsSync(join(ROOT, 'src/bootstrap/cleanup-obsolete-auth.ts')), 'auth cleanup migration');
  const boot = read('src/bootstrap/app-initializer.ts');
  assert(boot.includes('migratePlaybackKeysToLocalNamespace'), 'playback migrate');
  assert(boot.includes('cleanupObsoleteAuthSecrets'), 'token cleanup');
  assert(!boot.includes('bindDownloadRealtime'), 'no WS bind');
  assert(!boot.includes('restoreAuthSession'), 'no session restore');
});

test('Visible EN catalog rejects cloud-auth UX strings', () => {
  const flat = flattenCatalog(en);
  const joined = Object.values(flat).join('\n');
  assert(!/Please sign in again to view your settings/i.test(joined), 'settings auth');
  assert(!/Please sign in again to update your settings/i.test(joined), 'settings save auth');
  assert(!/session expired/i.test(joined), 'session expired');
  assert(!/backend unavailable/i.test(joined), 'backend unavailable');
  assert(!/Failed to sync/i.test(joined), 'failed to sync');
  assert(!/login required/i.test(joined), 'login required');
  // Media-origin "unauthorized" mapping is allowed; VidoraX account auth is not.
  assert(
    flat['errors.codes.UNAUTHORIZED']?.includes('media source') ||
      flat['errors.unauthorized']?.includes('media source'),
    '401 maps to media origin, not VidoraX login',
  );
});

test('EN/UR catalog parity holds for freeze', () => {
  const enKeys = Object.keys(flattenCatalog(en)).sort();
  const urKeys = Object.keys(flattenCatalog(ur)).sort();
  assert(enKeys.length === urKeys.length, `key count en=${enKeys.length} ur=${urKeys.length}`);
  for (let i = 0; i < enKeys.length; i += 1) {
    assert(enKeys[i] === urKeys[i], `parity break at ${enKeys[i]} vs ${urKeys[i]}`);
  }
});

test('Freeze documentation present', () => {
  assert(
    existsSync(join(ROOT, 'src/LOCAL-ONLY-MIGRATION-FREEZE.md')),
    'LOCAL-ONLY-MIGRATION-FREEZE.md required',
  );
  const freeze = read('src/LOCAL-ONLY-MIGRATION-FREEZE.md').toLowerCase();
  assert(freeze.includes('local download catalog'), 'catalog freeze');
  assert(freeze.includes('auth-free startup'), 'auth-free freeze');
  assert(freeze.includes('no-backend'), 'no-backend freeze');
});

test('Package script verify:local-only-final is wired', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert(
    Boolean(pkg.scripts?.['verify:local-only-final']),
    'verify:local-only-final script',
  );
});

if (failed > 0) {
  console.log(`\nLocal-Only Final FAILED: ${failed} check(s), ${passed} passed.`);
  process.exit(1);
}

console.log(`\nLocal-Only Migration Final — ${passed} passed, 0 failed.`);
console.log('Status: Automated Verified (device runtime matrix separate).');
