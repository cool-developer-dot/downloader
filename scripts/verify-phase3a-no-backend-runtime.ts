/**
 * Phase 3A — no VidoraX backend/API runtime in production mobile.
 * Static checks only. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-phase3a-no-backend-runtime.ts
 *   npm run verify:phase3a-no-backend-runtime
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

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

function read(relFromMobile: string): string {
  return readFileSync(join(ROOT, relFromMobile), 'utf8');
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

console.log('Phase 3A — no VidoraX backend runtime\n');

test('environment has no API_BASE_URL / api.vidorax.com', () => {
  const env = read('src/constants/environment.ts');
  assert(!env.includes('API_BASE_URL'), 'no API_BASE_URL');
  assert(!env.includes('EXPO_PUBLIC_API'), 'no EXPO_PUBLIC_API*');
  assert(!env.includes('api.vidorax.com'), 'no prod API host');
  assert(!env.includes('/health'), 'no health probe config');
  assert(!env.includes('WebSocket'), 'no WS URL config');
  const example = read('.env.example');
  assert(
    !/^\s*EXPO_PUBLIC_API_BASE_URL\s*=/m.test(example),
    '.env.example must not assign API base URL',
  );
});

test('axios is not a production dependency or import', () => {
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert(!pkg.dependencies?.axios, 'axios not in dependencies');
  assert(!existsSync(join(SRC, 'api/axios.ts')), 'api/axios.ts removed');
  assert(!existsSync(join(SRC, 'api/request.ts')), 'api/request.ts removed');
  for (const file of walkTsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (/from ['"]axios['"]|require\(['"]axios['"]\)/.test(text)) {
      throw new Error(`axios import in ${relative(ROOT, file)}`);
    }
  }
});

test('obsolete API modules are gone', () => {
  const banned = [
    'auth.api.ts',
    'user.api.ts',
    'avatar.api.ts',
    'settings.api.ts',
    'history.api.ts',
    'bookmarks.api.ts',
    'playback.api.ts',
    'downloads.api.ts',
    'media.api.ts',
    'favorites.api.ts',
    'token.ts',
  ];
  for (const name of banned) {
    assert(!existsSync(join(SRC, 'api', name)), `removed api/${name}`);
  }
  const apiIndex = read('src/api/index.ts');
  assert(!apiIndex.includes('LoginRequest'), 'no login types export');
  assert(!apiIndex.includes('AvatarUpload'), 'no avatar types export');
  assert(!apiIndex.includes('Tokens'), 'no token DTO export');
});

test('no realtime / WebSocket cloud bootstrap', () => {
  assert(!existsSync(join(SRC, 'realtime')), 'realtime/ directory removed');
  const boot = read('src/bootstrap/app-initializer.ts');
  assert(!boot.includes('bindDownloadRealtime'), 'no realtime bind');
  assert(!boot.includes('restoreAuthSession'), 'no auth session restore');
  assert(!boot.includes('setAccessTokenProvider'), 'no token provider');
  assert(!boot.includes('/ws/downloads'), 'no ws path');
  assert(!boot.includes('/health'), 'no health probe on boot');
  for (const file of walkTsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('/ws/downloads') || text.includes('new WebSocket')) {
      throw new Error(`cloud WS remnant in ${relative(ROOT, file)}`);
    }
  }
});

test('no account / auth credential routes', () => {
  const paths = read('src/navigation/constants/route-paths.ts');
  assert(!paths.includes('signIn'), 'no signIn');
  assert(!paths.includes('signUp'), 'no signUp');
  assert(!paths.includes('forgotPassword'), 'no forgotPassword');
  assert(!/profile:/.test(paths), 'no profile path');
  const authLayout = read('src/app/(auth)/_layout.tsx');
  assert(!authLayout.includes('sign-in'), 'no sign-in stack');
  assert(!authLayout.includes('sign-up'), 'no sign-up stack');
  const appLayout = read('src/app/(app)/_layout.tsx');
  assert(!appLayout.includes('profile'), 'no profile stack');
  assert(!appLayout.includes('edit-profile'), 'no edit-profile stack');
  assert(!existsSync(join(SRC, 'screens/auth')), 'screens/auth removed');
  assert(!existsSync(join(SRC, 'screens/profile')), 'screens/profile removed');
});

test('library / downloads have no VidoraX remote side effects', () => {
  const repo = read('src/library/repository.ts');
  assert(!repo.includes('fetchRemoteLibrary'), 'no remote library fetch');
  assert(!repo.includes('refreshRemoteMetadata'), 'no remote refresh');
  const downloads = read('src/store/downloads/actions.ts');
  assert(!downloads.includes('pendingDeleteIds'), 'no pending remote delete');
  assert(!downloads.includes('pendingDeleteRetryTimers'), 'no remote delete retry');
  assert(!downloads.includes('downloadsApi'), 'no downloads API');
  const fav = read('src/store/favorites/actions.ts');
  assert(!fav.includes('patchMediaFavorite'), 'no remote favorite patch');
  assert(!fav.includes('favoritesApi'), 'no favorites API');
});

test('settings screen is local-only structure', () => {
  const screen = read('src/screens/settings/SettingsScreen.tsx');
  assert(screen.includes('AppearanceSection'), 'appearance');
  assert(screen.includes('GeneralSection'), 'general');
  assert(screen.includes('DownloadsSection'), 'downloads');
  assert(screen.includes('StorageSection'), 'storage');
  assert(screen.includes('SupportSection'), 'support');
  assert(screen.includes('LegalSection'), 'legal');
  assert(!screen.includes('AccountSection'), 'no account section');
  assert(!screen.includes('SettingsSignOut'), 'no sign out');
  assert(!screen.includes('PlaybackSection'), 'no empty playback section');
});

test('visible settings/history copy is not cloud-auth gated', () => {
  const en = read('src/localization/en.ts');
  assert(!en.includes('Please sign in again to view your settings'), 'no settings sign-in');
  assert(!en.includes('Please sign in again to update your settings'), 'no settings save sign-in');
  assert(
    !en.includes('Support and your VidoraX profile'),
    'no profile help copy',
  );
  const history = read('src/screens/history/constants/history.constants.ts');
  assert(
    !history.includes('and your account'),
    'history clear is device-local',
  );
});

test('React Query remains only for legitimate local playback UI', () => {
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert(
    Boolean(pkg.dependencies?.['@tanstack/react-query']),
    'react-query kept for playback hooks',
  );
  const hooks = read('src/playback/hooks.ts');
  assert(hooks.includes('@tanstack/react-query'), 'playback uses RQ');
});

if (failed > 0) {
  console.log(`\nPhase 3A failed: ${failed} check(s), ${passed} passed.`);
  process.exit(1);
}

console.log(`\nAll Phase 3A checks passed (${passed}).`);
