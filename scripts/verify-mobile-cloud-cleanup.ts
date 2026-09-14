/**
 * Mobile cloud/runtime cleanup — static contracts for dead auth/avatar/cloud paths.
 * Complements verify:phase3a-no-backend-runtime. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-mobile-cloud-cleanup.ts
 *   npm run verify:mobile-cloud-cleanup
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

console.log('Mobile cloud/runtime cleanup\n');

test('avatar / profile media stack removed', () => {
  assert(!existsSync(join(SRC, 'services/media')), 'services/media gone');
  assert(!existsSync(join(SRC, 'services/avatar')), 'services/avatar gone');
  assert(!existsSync(join(SRC, 'components/common/Avatar.tsx')), 'Avatar gone');
  assert(!existsSync(join(SRC, 'utils/format-date.ts')), 'formatMemberSince gone');
  assert(!existsSync(join(SRC, 'utils/get-initials.ts')), 'getInitials gone');
  const appJson = read('app.json');
  assert(!appJson.includes('expo-image-picker'), 'no image-picker plugin');
  assert(!appJson.includes('profile picture'), 'no profile camera copy');
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert(!pkg.dependencies?.['expo-image-picker'], 'expo-image-picker dep removed');
  assert(
    !pkg.dependencies?.['expo-image-manipulator'],
    'expo-image-manipulator dep removed',
  );
});

test('secure auth persist adapter removed', () => {
  assert(
    !existsSync(join(SRC, 'store/shared/secure-storage.ts')),
    'secure-storage gone',
  );
  assert(!existsSync(join(SRC, 'navigation/AuthGuard.tsx')), 'AuthGuard file gone');
  const guards = read('src/navigation/guards/ProtectedRouteGuard.tsx');
  assert(!guards.includes('export const AuthGuard'), 'AuthGuard alias gone');
});

test('playback production bind is local-only (no remote timer without transport)', () => {
  const bind = read('src/playback/bind-playback-persistence.ts');
  assert(bind.includes('sync: overrides?.sync === undefined ? null : overrides.sync'), 'sync null default');
  assert(!bind.includes('resetPlaybackPersistenceForLogout'), 'no logout reset export');
  const coord = read('src/playback/coordinator.ts');
  assert(coord.includes('hasRemoteTransport'), 'local-only remote gate');
  assert(coord.includes('if (!this.hasRemoteTransport())'), 'scheduleRemoteSync gated');
});

test('React Query defaults suit local playback UI', () => {
  const qc = read('src/services/query-client.ts');
  assert(qc.includes("networkMode: 'always'"), 'networkMode always');
  assert(qc.includes('refetchOnReconnect: false'), 'no reconnect refetch storm');
});

test('settings preference writers are void (no cloud pendingSync result)', () => {
  const svc = read('src/services/auth/settings.service.ts');
  assert(!svc.includes('pendingSync'), 'no pendingSync result shape');
  assert(svc.includes('Promise<void>'), 'void preference writers');
});

test('no production JWT / Bearer attachment paths', () => {
  for (const file of walkTsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (/Authorization:\s*[`']Bearer|setAccessTokenProvider|refreshToken\s*=/.test(text)) {
      throw new Error(`token attachment remnant in ${relative(ROOT, file)}`);
    }
  }
});

test('visible download/bookmark copy is device-local', () => {
  const downloads = read('src/screens/downloads/constants/downloads.constants.ts');
  assert(!downloads.includes('your account'), 'downloads copy local');
  const bookmarks = read('src/screens/bookmarks/constants/bookmarks.constants.ts');
  assert(!bookmarks.includes('your account'), 'bookmarks copy local');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
