/**
 * Week 8 Day 3 Phase 2 — Resume / Continue Watching / Recently Watched / History.
 * Pure logic. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day3-phase2.ts
 */

import { applyLibraryQuery } from '../src/library/query';
import type { MediaLibraryItem } from '../src/library/types';
import { PLAYBACK_MIN_RESUME_SECONDS } from '../src/playback/constants';
import { isContinueWatchingEligible, sortByLastPlayedDesc } from '../src/playback/domain/continue-watching';
import { resolveCompletedState } from '../src/playback/domain/completion';
import {
  formatLastPlayedLabel,
  formatResumeLabel,
} from '../src/playback/domain/format';
import {
  mergePlaybackStates,
  type PlaybackSummary,
} from '../src/playback/domain/merge';
import { isResumeEligible } from '../src/playback/domain/resume';
import { shouldResetCompletedOnReplay } from '../src/playback/domain/replay-reset';
import { enrichLibraryWithPlayback } from '../src/playback/enrich-library';
import {
  configurePlaybackStorageAdapter,
  resetPlaybackStorageForTests,
  savePlaybackState,
  type PlaybackStorageAdapter,
} from '../src/playback/persistence';

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

function memoryAdapter(): PlaybackStorageAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    getAllKeys: () => Array.from(store.keys()),
  };
}

function media(
  id: string,
  overrides: Partial<MediaLibraryItem> = {},
): MediaLibraryItem {
  return {
    id,
    downloadId: id,
    displayName: `Video ${id}`,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: '1000',
    quality: '1080p',
    resolution: '1920x1080',
    bitrate: 1,
    duration: 600,
    downloadedAt: '2026-08-01T00:00:00.000Z',
    favorite: false,
    folderId: null,
    folderName: null,
    localAvailability: 'available',
    thumbnailUri: null,
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
    ...overrides,
  };
}

function summary(
  mediaId: string,
  overrides: Partial<PlaybackSummary> = {},
): PlaybackSummary {
  return {
    mediaId,
    positionSeconds: 60,
    durationSeconds: 600,
    progressPercent: 10,
    lastPlayedAt: '2026-08-22T12:00:00.000Z',
    completed: false,
    updatedAt: '2026-08-22T12:00:00.000Z',
    pendingSync: false,
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('Week 8 Day 3 Phase 2 — playback intelligence verifier\n');

  await test('resume: position 2s not eligible', () => {
    assert(
      !isResumeEligible({
        positionSeconds: 2,
        durationSeconds: 600,
        completed: false,
      }),
      'too early',
    );
  });

  await test('resume: position 60s eligible', () => {
    assert(
      isResumeEligible({
        positionSeconds: 60,
        durationSeconds: 600,
        completed: false,
      }),
      'mid',
    );
    assert(PLAYBACK_MIN_RESUME_SECONDS === 15, 'constant');
  });

  await test('resume: completed not eligible', () => {
    assert(
      !isResumeEligible({
        positionSeconds: 60,
        durationSeconds: 600,
        completed: true,
      }),
      'completed',
    );
  });

  await test('resume: near end not eligible', () => {
    assert(
      !isResumeEligible({
        positionSeconds: 580,
        durationSeconds: 600,
        completed: false,
      }),
      'near end',
    );
  });

  await test('merge: newer local wins', () => {
    const local = summary('m1', {
      positionSeconds: 120,
      updatedAt: '2026-08-22T13:00:00.000Z',
    });
    const remote = summary('m1', {
      positionSeconds: 40,
      updatedAt: '2026-08-22T12:00:00.000Z',
    });
    const merged = mergePlaybackStates(local, remote);
    assert(merged?.positionSeconds === 120, 'local newer');
  });

  await test('merge: newer remote wins', () => {
    const local = summary('m1', {
      positionSeconds: 40,
      updatedAt: '2026-08-22T12:00:00.000Z',
    });
    const remote = summary('m1', {
      positionSeconds: 200,
      updatedAt: '2026-08-22T14:00:00.000Z',
    });
    const merged = mergePlaybackStates(local, remote);
    assert(merged?.positionSeconds === 200, 'remote newer');
  });

  await test('offline local resume available', () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    savePlaybackState('user-1', {
      mediaId: 'm1',
      positionSeconds: 90,
      durationSeconds: 600,
      progressPercent: 15,
      lastPlayedAt: '2026-08-22T12:00:00.000Z',
      completed: false,
      updatedAt: '2026-08-22T12:00:00.000Z',
      pendingSync: true,
    });
    const merged = mergePlaybackStates(
      {
        mediaId: 'm1',
        positionSeconds: 90,
        durationSeconds: 600,
        progressPercent: 15,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T12:00:00.000Z',
        pendingSync: true,
      },
      null,
    );
    assert(
      isResumeEligible({
        positionSeconds: merged!.positionSeconds,
        durationSeconds: merged!.durationSeconds,
        completed: merged!.completed,
      }),
      'offline resume',
    );
  });

  await test('continue watching: unfinished included; completed/missing excluded', () => {
    assert(
      isContinueWatchingEligible(summary('a'), { localAvailable: true }),
      'include',
    );
    assert(
      !isContinueWatchingEligible(summary('b', { completed: true }), {
        localAvailable: true,
      }),
      'completed out',
    );
    assert(
      !isContinueWatchingEligible(summary('c', { positionSeconds: 5 }), {
        localAvailable: true,
      }),
      'too small',
    );
    assert(
      !isContinueWatchingEligible(summary('d'), { localAvailable: false }),
      'missing out',
    );
  });

  await test('continue watching: lastPlayedAt DESC', () => {
    const sorted = sortByLastPlayedDesc([
      summary('old', { lastPlayedAt: '2026-08-20T00:00:00.000Z' }),
      summary('new', { lastPlayedAt: '2026-08-22T00:00:00.000Z' }),
    ]);
    assert(sorted[0]?.mediaId === 'new', 'newest first');
  });

  await test('recently watched filter uses lastPlayedAt; independent of download', () => {
    const items = [
      media('played', {
        lastPlayedAt: '2026-08-22T00:00:00.000Z',
        downloadedAt: '2026-07-01T00:00:00.000Z',
      }),
      media('never', {
        lastPlayedAt: null,
        downloadedAt: '2026-08-21T00:00:00.000Z',
      }),
    ];
    const result = applyLibraryQuery(items, {
      search: '',
      filter: 'recently_watched',
      sort: 'newest',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: 7 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    assert(result.items.length === 1, 'only played');
    assert(result.items[0]?.id === 'played', 'played id');

    const downloaded = applyLibraryQuery(items, {
      search: '',
      filter: 'recently_downloaded',
      sort: 'newest',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: 7 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    assert(downloaded.items.some((i) => i.id === 'never'), 'download independent');
  });

  await test('library enrich joins playback by mediaId', () => {
    const items = [media('m1'), media('m2')];
    const map = new Map([
      [
        'm1',
        summary('m1', {
          progressPercent: 40,
          positionSeconds: 240,
          lastPlayedAt: '2026-08-22T10:00:00.000Z',
        }),
      ],
    ]);
    const enriched = enrichLibraryWithPlayback(items, map);
    assert(enriched[0]?.lastPlayedAt != null, 'joined');
    assert(enriched[0]?.progressPercent === 40, 'progress');
    assert(enriched[1]?.lastPlayedAt == null, 'untouched');
  });

  await test('replay reset only when started near beginning', () => {
    assert(
      shouldResetCompletedOnReplay({
        completed: true,
        playbackStarted: true,
        positionSeconds: 2,
      }),
      'reset',
    );
    assert(
      !shouldResetCompletedOnReplay({
        completed: true,
        playbackStarted: false,
        positionSeconds: 2,
      }),
      'no start',
    );
    assert(
      !shouldResetCompletedOnReplay({
        completed: true,
        playbackStarted: true,
        positionSeconds: 400,
      }),
      'stale mid',
    );
    assert(
      resolveCompletedState({
        positionSeconds: 2,
        durationSeconds: 600,
        existingCompleted: true,
        replayReset: true,
      }) === false,
      'clears completed',
    );
    assert(
      resolveCompletedState({
        positionSeconds: 2,
        durationSeconds: 600,
        existingCompleted: true,
      }) === true,
      'sticky without reset',
    );
  });

  await test('format helpers', () => {
    assert(formatResumeLabel(754).includes('12:34'), formatResumeLabel(754));
    assert(formatLastPlayedLabel(new Date().toISOString()) === 'Just now', 'now');
  });

  await test('100+ history merge stable unique mediaId', () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      summary(`m${i}`, {
        lastPlayedAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(),
      }),
    );
    const sorted = sortByLastPlayedDesc(many);
    assert(sorted.length === 120, 'count');
    assert(sorted[0]?.mediaId === 'm119', 'order');
    const ids = new Set(sorted.map((s) => s.mediaId));
    assert(ids.size === 120, 'unique');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
