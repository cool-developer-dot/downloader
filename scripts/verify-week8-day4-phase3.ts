/**
 * Week 8 Day 4 Phase 3 — release freeze contracts (mobile).
 *
 * Static certification only. Does not claim emulator/device results.
 * After this phase, treat as frozen unless a reproduced bug, security issue,
 * or explicit product requirement:
 *   Download Engine, Library identity, Player state machine,
 *   PlaybackHistory reconciliation, file-action architecture.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day4-phase3.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLAYBACK_BACKEND_SYNC_INTERVAL_MS,
  PLAYBACK_LOCAL_PERSIST_INTERVAL_MS,
} from '../src/playback/constants';
import { PROGRESS_INTERVAL_SECONDS } from '../src/player/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
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

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

function read(relFromMobile: string): string {
  return readFileSync(join(ROOT, relFromMobile), 'utf8');
}

async function main(): Promise<void> {
await test('production API default is HTTPS host, not localhost', () => {
  const source = read('src/constants/environment.ts');
  assert(
    source.includes("const DEFAULT_PROD_API_BASE_URL = 'https://api.vidorax.com'"),
    'production default API host missing',
  );
  assert(
    source.includes("const currentEnvironment: AppEnvironment = __DEV__ ? 'development' : 'production'"),
    'environment must be __DEV__-gated',
  );
  assert(
    /readConfiguredApiBaseUrl\(DEFAULT_PROD_API_BASE_URL\)/.test(source),
    'production API must be env-driven with prod fallback',
  );
  assert(
    !/DEFAULT_PROD_API_BASE_URL = 'http:\/\/localhost/.test(source),
    'production default must not be localhost',
  );
});

await test('Android Share/Open use content URI, not raw file paths', () => {
  const fileActions = read('src/downloads/engine/file-actions.ts');
  const mediaActions = read('src/downloads/engine/media-file-actions.ts');
  assert(
    fileActions.includes('contentUri') &&
      /Platform\.OS === 'android'[\s\S]*contentUri/.test(fileActions),
    'file-actions Android share/open must use File.contentUri',
  );
  assert(
    !fileActions.includes('FileSystem.getContentUriAsync') &&
      !/getContentUriAsync\(/.test(fileActions),
    'file-actions must not call deprecated getContentUriAsync',
  );
  assert(
    mediaActions.includes('contentUri') &&
      !mediaActions.includes('FileSystem.getContentUriAsync') &&
      !/getContentUriAsync\(/.test(mediaActions),
    'media-file-actions must convert Android URIs via File.contentUri',
  );
  assert(
    !/Share\.share\([\s\S]*file:\/\//.test(fileActions),
    'Share must not pass a hardcoded file:// URI',
  );
});

await test('playback persist cadence is not per-350ms / per-second logging', () => {
  assert(PROGRESS_INTERVAL_SECONDS === 0.35, 'UI tick remains 350ms');
  assert(PLAYBACK_LOCAL_PERSIST_INTERVAL_MS === 5_000, 'local persist 5s');
  assert(PLAYBACK_BACKEND_SYNC_INTERVAL_MS === 15_000, 'backend sync 15s');
  const session = read('src/player/use-player-session.ts');
  const timeUpdate = session.slice(session.indexOf("useEventListener(player, 'timeUpdate'"));
  const block = timeUpdate.slice(0, timeUpdate.indexOf("useEventListener(player, 'playToEnd'"));
  assert(!block.includes('playerLog('), 'timeUpdate must not log per tick');
});

await test('player/playback diagnostics sanitize secrets and gate info in production', () => {
  const playerDiag = read('src/player/diagnostics.ts');
  const playbackDiag = read('src/playback/diagnostics.ts');
  for (const source of [playerDiag, playbackDiag]) {
    assert(source.includes("'accessToken'"), 'must block accessToken');
    assert(source.includes("'refreshToken'"), 'must block refreshToken');
    assert(source.includes("'localUri'"), 'must block localUri');
    assert(
      source.includes('if (!isDev && level === \'info\')'),
      'info logs must be development-gated',
    );
  }
});

await test('no TODO/FIXME/HACK/TEMP release markers in production src', () => {
  const marker = /(?:^|\s)(?:\/\/|\/\*)\s*(TODO|FIXME|HACK|TEMP)\b/;
  const hits: string[] = [];
  for (const file of collectSourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (marker.test(line)) {
        hits.push(`${relative(SRC, file)}: ${line.trim()}`);
      }
    }
  }
  assert(hits.length === 0, hits.join('\n      '));
});

await test('production media paths are not driven by mock/fake/demo fixtures', () => {
  const banned = [
    'placeholder history',
    'fakeHistory',
    'mockHistory',
    'hardcoded video',
    'demoPlayback',
    'FAKE_DOWNLOAD',
  ];
  const hits: string[] = [];
  for (const file of collectSourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const lower = text.toLowerCase();
    for (const token of banned) {
      if (lower.includes(token.toLowerCase())) {
        hits.push(`${relative(SRC, file)} contains ${token}`);
      }
    }
  }
  assert(hits.length === 0, hits.join('\n      '));
});

await test('architecture freeze markers remain the current production modules', () => {
  assert(statSync(join(SRC, 'downloads/engine/index.ts')).isFile(), 'Download Engine');
  assert(statSync(join(SRC, 'library/assemble.ts')).isFile(), 'Library identity');
  assert(statSync(join(SRC, 'player/use-player-session.ts')).isFile(), 'Player state machine');
  assert(statSync(join(SRC, 'playback/coordinator.ts')).isFile(), 'PlaybackHistory reconciliation');
  assert(statSync(join(SRC, 'downloads/engine/file-actions.ts')).isFile(), 'file-action architecture');
});

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
