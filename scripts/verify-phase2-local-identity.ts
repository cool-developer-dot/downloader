/**
 * Phase 2 — local identity / auth-free startup static checks.
 * Run: npx tsx scripts/verify-phase2-local-identity.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const PLAYBACK_PREFIX = 'vidorax.playback.v1';
const LOCAL_NS = 'local';

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function playbackKey(namespace: string, mediaId: string): string {
  return `${PLAYBACK_PREFIX}:${namespace}:${mediaId}`;
}

function parsePlaybackKey(
  key: string,
): { namespace: string; mediaId: string } | null {
  const prefix = `${PLAYBACK_PREFIX}:`;
  if (!key.startsWith(prefix)) {
    return null;
  }
  const rest = key.slice(prefix.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const namespace = rest.slice(0, colon);
  const mediaId = rest.slice(colon + 1);
  if (!namespace || !mediaId) {
    return null;
  }
  return { namespace, mediaId };
}

type Row = { positionSeconds: number; updatedAt: string };

function migrateMap(store: Map<string, Row>): {
  migrated: number;
  skippedNewerLocal: number;
  removed: number;
} {
  let migrated = 0;
  let skippedNewerLocal = 0;
  let removed = 0;
  for (const key of [...store.keys()]) {
    const parsed = parsePlaybackKey(key);
    if (!parsed || parsed.namespace === LOCAL_NS) {
      continue;
    }
    const incoming = store.get(key);
    const localKey = playbackKey(LOCAL_NS, parsed.mediaId);
    const existing = store.get(localKey);
    if (incoming) {
      if (!existing) {
        store.set(localKey, incoming);
        migrated += 1;
      } else if (Date.parse(existing.updatedAt) >= Date.parse(incoming.updatedAt)) {
        skippedNewerLocal += 1;
      } else {
        store.set(localKey, incoming);
        migrated += 1;
      }
    }
    store.delete(key);
    removed += 1;
  }
  return { migrated, skippedNewerLocal, removed };
}

console.log('Phase 2 local identity verification\n');

test('startup routing is splash → cinematic splash → home', () => {
  const postSplash = read('src/navigation/helpers/resolve-post-splash-route.ts');
  assert(!postSplash.includes('isAuthenticated'), 'post-splash must not check auth');
  assert(!postSplash.includes('signUp'), 'post-splash must not send users to signup');
  assert(!postSplash.includes('signIn'), 'post-splash must not send users to sign-in');
  assert(postSplash.includes('routePaths.onboarding'), 'cinematic splash branch');
  assert(
    !postSplash.includes('routePaths.home'),
    'post-splash must not skip to home via persisted onboarding',
  );
  const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
  assert(onboarding.includes('routePaths.home'), 'cinematic splash finishes at Home');
  assert(!onboarding.includes('signUp'), 'onboarding must not go to signup');
});

test('app stack is not auth-gated', () => {
  const guard = read('src/navigation/guards/ProtectedRouteGuard.tsx');
  assert(guard.includes('selectAppInitialized'), 'waits for local init');
  assert(!guard.includes('isAuthenticated'), 'no isAuthenticated gate');
  assert(!guard.includes('sessionRestored'), 'no session-restored gate');
  assert(!guard.includes('signIn'), 'no sign-in redirect');
  const appLayout = read('src/app/(app)/_layout.tsx');
  assert(!appLayout.includes('profile'), 'no profile stack screen');
  assert(!appLayout.includes('edit-profile'), 'no edit-profile stack screen');
});

test('auth credential routes are removed', () => {
  const authLayout = read('src/app/(auth)/_layout.tsx');
  assert(authLayout.includes('splash'), 'splash remains');
  assert(authLayout.includes('onboarding'), 'onboarding remains');
  assert(!authLayout.includes('sign-in'), 'no sign-in route');
  assert(!authLayout.includes('sign-up'), 'no sign-up route');
  assert(!authLayout.includes('AuthCredentialScreen'), 'no flip-card auth shell');
  const paths = read('src/navigation/constants/route-paths.ts');
  assert(!paths.includes('signIn'), 'no signIn path');
  assert(!paths.includes('signUp'), 'no signUp path');
  assert(!paths.includes('forgotPassword'), 'no forgotPassword path');
  assert(!/profile:/.test(paths), 'no profile path');
});

test('playback uses local namespace', () => {
  const constants = read('src/playback/constants.ts');
  assert(constants.includes("PLAYBACK_LOCAL_NAMESPACE = 'local'"), 'local namespace');
  const persistence = read('src/playback/persistence.ts');
  assert(persistence.includes('migratePlaybackKeysToLocalNamespace'), 'migration export');
  assert(persistence.includes('PLAYBACK_LOCAL_NAMESPACE'), 'persistence uses local ns');
  assert(
    playbackKey(LOCAL_NS, 'media-1') === `${PLAYBACK_PREFIX}:local:media-1`,
    'key shape playback:local:mediaId',
  );
  const parsed = parsePlaybackKey(`${PLAYBACK_PREFIX}:abc-user:clip-9`);
  assert(parsed?.namespace === 'abc-user', 'legacy namespace parse');
  assert(parsed?.mediaId === 'clip-9', 'mediaId preserved');
});

test('playback migration contract is idempotent and keeps newer local', () => {
  const store = new Map<string, Row>([
    [
      playbackKey('old-user', 'clip-a'),
      { positionSeconds: 12, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    [
      playbackKey(LOCAL_NS, 'clip-a'),
      { positionSeconds: 40, updatedAt: '2026-02-01T00:00:00.000Z' },
    ],
    [
      playbackKey('old-user', 'clip-b'),
      { positionSeconds: 8, updatedAt: '2026-01-02T00:00:00.000Z' },
    ],
  ]);
  const first = migrateMap(store);
  assert(first.migrated === 1, 'copied missing local key');
  assert(first.skippedNewerLocal === 1, 'kept newer local');
  assert(store.get(playbackKey(LOCAL_NS, 'clip-a'))?.positionSeconds === 40, 'newer local kept');
  assert(store.get(playbackKey(LOCAL_NS, 'clip-b'))?.positionSeconds === 8, 'legacy copied');
  assert(
    ![...store.keys()].some((key) => key.includes(':old-user:')),
    'obsolete keys removed',
  );
  const second = migrateMap(store);
  assert(second.migrated === 0 && second.removed === 0, 'second pass is a no-op');
  const persistence = read('src/playback/persistence.ts');
  assert(persistence.includes('alreadyComplete'), 'marks complete only after success');
  assert(persistence.includes('skippedNewerLocal'), 'newer-local skip exists');
});

test('auth SecureStore cleanup allowlist is targeted', () => {
  const cleanup = read('src/bootstrap/cleanup-obsolete-auth.ts');
  const keys = read('src/constants/storage-keys.ts');
  assert(cleanup.includes('storageKeys.authToken'), 'access token');
  assert(cleanup.includes('storageKeys.refreshToken'), 'refresh token');
  assert(cleanup.includes('storageKeys.profileSnapshot'), 'profile snapshot');
  assert(cleanup.includes('storageKeys.auth'), 'auth persist blob');
  assert(!cleanup.includes('userPreferences'), 'must not clear preferences');
  assert(!cleanup.includes('themePreference'), 'must not clear theme');
  assert(!cleanup.includes('mmkvClearAll'), 'must not wipe MMKV');
  assert(cleanup.includes('getAuthSecretsClearedV1'), 'idempotent flag');
  assert(keys.includes("authToken: 'vidorax.auth.token'"), 'token key remains named');
});

test('Home and Settings do not require auth/session', () => {
  const home = read('src/screens/home/hooks/useHomeDashboard.ts');
  assert(!home.includes('useAuthStore'), 'Home has no auth store');
  assert(!home.includes('useUserStore'), 'Home has no user store');
  const header = read('src/screens/home/components/HomeHeader.tsx');
  assert(header.includes('headline'), 'neutral greeting');
  assert(!header.includes('Avatar'), 'no account avatar');
  assert(!header.includes('profile'), 'no profile navigation');
  const settings = read('src/screens/settings/hooks/useSettingsScreen.ts');
  assert(!settings.includes('useAuthStore'), 'Settings has no auth store');
  assert(!settings.includes('loadSettings'), 'no GET /settings');
  assert(!settings.includes('signOut'), 'no sign out');
  const screen = read('src/screens/settings/SettingsScreen.tsx');
  assert(!screen.includes('AccountSection'), 'no Account section');
  assert(screen.includes('AppearanceSection'), 'appearance remains');
  assert(screen.includes('SupportSection'), 'support remains');
  assert(screen.includes('LegalSection'), 'legal remains');
});

test('history and bookmarks are SQLite-authoritative', () => {
  const history = read('src/storage/services/history.service.ts');
  assert(!history.includes('historyApi'), 'no history API');
  assert(!history.includes('isAuthenticated'), 'no auth gate');
  assert(!history.includes('syncFromRemote'), 'no remote hydrate');
  const bookmarks = read('src/storage/services/bookmark.service.ts');
  assert(!bookmarks.includes('bookmarksApi'), 'no bookmarks API');
  assert(!bookmarks.includes('isAuthenticated'), 'no auth gate');
  assert(!bookmarks.includes('syncFromRemote'), 'no remote hydrate');
  const historyStore = read('src/store/history/actions.ts');
  assert(!historyStore.includes('syncFromRemote'), 'history store is local');
  const bookmarkStore = read('src/store/bookmarks/actions.ts');
  assert(!bookmarkStore.includes('syncFromRemote'), 'bookmark store is local');
});

test('bootstrap does not restore JWT/session or bind auth realtime', () => {
  const boot = read('src/bootstrap/app-initializer.ts');
  assert(!boot.includes('restoreAuthSession'), 'no session restore');
  assert(!boot.includes('setAccessTokenProvider'), 'no token provider');
  assert(!boot.includes('bindDownloadRealtime'), 'no JWT realtime bind');
  assert(boot.includes('migratePlaybackKeysToLocalNamespace'), 'playback migration runs');
  assert(boot.includes('cleanupObsoleteAuthSecrets'), 'auth secret cleanup runs');
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  assert(!existsSync(resolve(root, 'src/api/axios.ts')), 'axios client removed');
  const bind = read('src/playback/bind-playback-persistence.ts');
  assert(bind.includes('sync: overrides?.sync === undefined ? null'), 'no default cloud sync');
});

console.log('\nPhase 2 local identity verification passed');
