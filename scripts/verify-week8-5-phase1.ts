/**
 * Week 8.5 Phase 1B — Home UX polish, theme, refresh, playback isolation.
 * Aggregates Phase 1A contracts plus Phase 1B static/logic checks.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase1.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldInvalidatePlaybackQueriesForEvent } from '../src/playback/query-keys';
import { HOME_COPY, HOME_DESTINATIONS, HOME_SECTION_LIMIT } from '../src/screens/home/constants/home.constants';
import { deriveStorageUsageRatio } from '../src/screens/home/utils/home-derive';
import { routePaths } from '../src/navigation/constants/route-paths';
import { colors } from '../src/theme/colors';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME_SRC = join(ROOT, 'src/screens/home');

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

async function main(): Promise<void> {
  const homeFiles = collectFiles(HOME_SRC);
  const homeText = homeFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

  await test('placeholder dashboard copy stays gone', () => {
    assert(
      !homeText.includes('Your VidoraX dashboard. Main features will be linked here.'),
      'placeholder copy returned',
    );
    assert(!homeText.includes('Home icon'), 'placeholder Home icon copy returned');
  });

  await test('no Home-only duplicate domain store or dashboard API', () => {
    assert(!homeText.includes('HomeHistory'), 'HomeHistory must not exist');
    assert(!homeText.includes('RecentHomeVideos'), 'RecentHomeVideos must not exist');
    assert(!homeText.includes('/home-dashboard'), 'must not poll a Home dashboard API');
    assert(
      homeText.includes('useQualitySelection'),
      'paste link must keep Phase 1A quality selection',
    );
  });

  await test('theme tokens used; no Home color system or hardcoded hex', () => {
    assert(homeText.includes('useTheme') || homeText.includes('useHomeLayout'), 'theme hook missing');
    assert(!/#[0-9A-Fa-f]{3,8}\b/.test(homeText), 'hardcoded hex color in Home');
    assert(!/rgba?\(/.test(homeText), 'hardcoded rgb color in Home');
    assert(
      !homeText.includes('createTheme') && !homeText.includes('homeTheme'),
      'Home must not define a second theme',
    );
    assert(
      Boolean(colors.light && colors.dark),
      'app themes must include light and dark',
    );
  });

  await test('layout consumes existing theme tokens', () => {
    const layout = readRel('src/screens/home/theme/home-layout.ts');
    assert(layout.includes('theme.spacing'), 'layout must use spacing tokens');
    assert(layout.includes('theme.radius'), 'layout must use radius tokens');
    assert(layout.includes('theme.icons'), 'layout must use icon tokens');
    assert(layout.includes('useWindowDimensions'), 'layout must be width-aware');
  });

  await test('loading uses Skeleton; refresh is single and non-polling', () => {
    assert(homeText.includes('Skeleton'), 'must use existing Skeleton');
    assert(homeText.includes('RefreshControl'), 'pull-to-refresh missing');
    const refresh = readRel('src/screens/home/hooks/useHomeDashboard.ts');
    assert(refresh.includes('inFlight'), 'refresh must dedupe concurrent pulls');
    assert(refresh.includes('allSettled'), 'refresh must not fail the whole Home');
    assert(!refresh.includes('setInterval'), 'no Home polling');
    assert(!refresh.includes('reconcileAvailability'), 'refresh must not force FS reconcile');
    assert(
      refresh.includes('playbackQueryKeys.continueWatching') &&
        refresh.includes('playbackQueryKeys.recent'),
      'refresh must target existing playback queries only',
    );
    assert(
      !refresh.includes('invalidatePlaybackUiQueries'),
      'must not blanket-invalidate every playback query',
    );
  });

  await test('playback isolation: Home never follows native progress ticks', () => {
    assert(!homeText.includes('usePlayerStore'), 'must not subscribe to player store');
    assert(!homeText.includes('transferById'), 'must not subscribe to transfer ticks');
    assert(!homeText.includes('positionChanged'), 'must not listen to playback ticks');
    assert(
      !shouldInvalidatePlaybackQueriesForEvent('positionChanged'),
      'position ticks must not invalidate continue/recent queries',
    );
    assert(
      shouldInvalidatePlaybackQueriesForEvent('playerExited'),
      'returning from Player should refresh at persistence boundary',
    );
  });

  await test('navigation destinations remain centralized', () => {
    assert(HOME_DESTINATIONS.browser === routePaths.browser, 'browser');
    assert(HOME_DESTINATIONS.downloads === routePaths.downloads, 'downloads');
    assert(HOME_DESTINATIONS.library === routePaths.library, 'library');
    assert(HOME_DESTINATIONS.settings === routePaths.settings, 'settings');
    const header = readRel('src/screens/home/components/HomeHeader.tsx');
    assert(header.includes('routePaths.settings'), 'settings shortcut missing');
    assert(!header.includes('profile'), 'profile action must be removed');
    assert(HOME_SECTION_LIMIT === 5, 'rows must stay bounded');
  });

  await test('accessibility labels exist for primary Home controls', () => {
    assert(HOME_COPY.pasteLinkA11y.length > 0, 'paste a11y');
    assert(HOME_COPY.openBrowserA11y.length > 0, 'browser a11y');
    assert(HOME_COPY.openSettingsA11y.length > 0, 'settings a11y');
    assert(HOME_COPY.refreshA11y.length > 0, 'refresh a11y');
    const card = readRel('src/screens/home/components/HomeMediaCard.tsx');
    assert(card.includes('accessibilityHint'), 'media cards need hints');
    assert(card.includes('importantForAccessibility'), 'thumbnails should be decorative');
  });

  await test('storage ratio is accurate only when free space is known', () => {
    assert(deriveStorageUsageRatio(100n, 100) === 0.5, '50% used');
    assert(deriveStorageUsageRatio(0n, 100) === 0, 'empty library');
    assert(deriveStorageUsageRatio(100n, null) === null, 'unknown free space');
    assert(deriveStorageUsageRatio(-1n, 10) === null, 'invalid used');
  });

  await test('Home architecture freeze marker is present', () => {
    const constants = readRel('src/screens/home/constants/home.constants.ts');
    assert(constants.includes('Phase 1B freeze'), 'freeze comment missing');
    assert(
      HOME_COPY.noVideosToContinue === 'Nothing playing right now',
      'continue empty copy should be production phrasing',
    );
  });

  console.log(`\nWeek 8.5 Phase 1B: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
