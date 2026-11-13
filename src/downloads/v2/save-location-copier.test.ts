import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { FolderCopy } from '@modules/vidorax-media/src/VidoraMedia.types';

import { DEFAULT_SAVE_LOCATION, type ExternalCopyRecord, type SaveLocationSettings } from './save-location';
import { copyFolderLabel, createSaveLocationCopier, type CopierItem } from './save-location-copier';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMovies';

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function harness(options: {
  settings?: Partial<SaveLocationSettings>;
  items?: Record<string, Partial<CopierItem> | null>;
  copy?: (id: string, treeUri: string, subfolders: string[]) => Promise<FolderCopy>;
} = {}) {
  let settings: SaveLocationSettings = {
    ...DEFAULT_SAVE_LOCATION,
    enabled: true,
    treeUri: TREE,
    folderName: 'Movies',
    enabledAt: 1,
    ...options.settings,
  };
  const records: Record<string, ExternalCopyRecord> = {};
  const calls: { id: string; treeUri: string; subfolders: string[] }[] = [];
  const events: string[] = [];
  const copier = createSaveLocationCopier({
    getSettings: () => settings,
    getItem: async (id) => {
      const item = options.items?.[id];
      if (item === null) {
        return null;
      }
      return { id, title: `Title ${id}`, mimeType: 'video/mp4', site: 'instagram', pageUrl: null, sizeBytes: 10, ...item };
    },
    copy:
      options.copy ??
      (async (id, treeUri, subfolders) => {
        calls.push({ id, treeUri, subfolders });
        return { documentUri: `content://doc/${id}`, folderUri: 'content://folder', name: `${id}.mp4`, bytes: 10 };
      }),
    hasRecord: (id) => Boolean(records[id]),
    record: (id, record) => {
      records[id] = record;
    },
    onAccessLost: () => {
      events.push('access-lost');
      settings = { ...settings, enabled: false, treeUri: null, accessLost: true };
    },
    onFailed: (item) => events.push(`failed:${item.id}`),
    onActiveChange: (id) => events.push(`active:${id ?? '-'}`),
    now: () => 777,
  });
  return {
    copier,
    records,
    calls,
    events,
    setSettings: (next: Partial<SaveLocationSettings>) => {
      settings = { ...settings, ...next };
    },
  };
}

describe('copier', () => {
  test('copies a completed item into the picked folder and records where it went', async () => {
    const h = harness({ settings: { byType: true, bySite: true } });
    assert.equal(h.copier.enqueue('a'), true);
    await h.copier.idle();
    assert.deepEqual(h.calls, [{ id: 'a', treeUri: TREE, subfolders: ['Videos', 'Instagram'] }]);
    assert.deepEqual(h.records.a, {
      status: 'copied',
      folderUri: 'content://folder',
      documentUri: 'content://doc/a',
      name: 'a.mp4',
      folderLabel: 'Movies/Videos/Instagram',
      at: 777,
    });
    assert.deepEqual(h.events, ['active:a', 'active:-']);
  });

  test('off by default: nothing is queued or copied', async () => {
    const h = harness({ settings: { enabled: false } });
    assert.equal(h.copier.enqueue('a'), false);
    await h.copier.idle();
    assert.equal(h.calls.length, 0);
  });

  test('one copy per item: queued, running or recorded items are not queued again', async () => {
    const h = harness();
    assert.equal(h.copier.enqueue('a'), true);
    assert.equal(h.copier.enqueue('a'), false);
    await h.copier.idle();
    assert.equal(h.copier.enqueue('a'), false);
    assert.equal(h.calls.length, 1);
  });

  test('copies run one at a time, in order', async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const h = harness({
      copy: async (id) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(id);
        running -= 1;
        return { documentUri: `content://doc/${id}`, folderUri: 'content://folder', name: id, bytes: 1 };
      },
    });
    h.copier.enqueue('a');
    h.copier.enqueue('b');
    h.copier.enqueue('c');
    await h.copier.idle();
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.equal(maxRunning, 1);
  });

  test('re-checked right before acting: an item deleted meanwhile is skipped without a record', async () => {
    const h = harness({ items: { gone: null } });
    h.copier.enqueue('gone');
    await h.copier.idle();
    assert.equal(h.calls.length, 0);
    assert.equal(h.records.gone, undefined);
  });

  test('re-checked right before acting: turning the option off stops copies not yet started', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const copied: string[] = [];
    const h = harness({
      copy: async (id) => {
        started();
        await gate;
        copied.push(id);
        return { documentUri: 'content://d', folderUri: 'content://f', name: id, bytes: 1 };
      },
    });
    h.copier.enqueue('a');
    h.copier.enqueue('b');
    await firstStarted;
    h.setSettings({ enabled: false });
    release();
    await h.copier.idle();
    // The copy already running finishes; the queued one never starts.
    assert.deepEqual(copied, ['a']);
  });

  test('turned off before the first copy starts: nothing is copied', async () => {
    const h = harness();
    h.copier.enqueue('a');
    h.setSettings({ enabled: false });
    await h.copier.idle();
    assert.equal(h.calls.length, 0);
  });

  test('a file missing on the native side leaves no record', async () => {
    const h = harness({
      copy: async () => {
        throw coded('ERR_NOT_FOUND');
      },
    });
    h.copier.enqueue('a');
    await h.copier.idle();
    assert.equal(h.records.a, undefined);
    assert.deepEqual(h.events, ['active:a', 'active:-']);
  });

  test('any other failure is recorded once and reported, never retried in a loop', async () => {
    const h = harness({
      copy: async () => {
        throw coded('ERR_STORAGE');
      },
    });
    h.copier.enqueue('a');
    await h.copier.idle();
    assert.deepEqual(h.records.a, { status: 'failed', reason: 'storage', at: 777 });
    assert.equal(h.events.includes('failed:a'), true);
    assert.equal(h.copier.enqueue('a'), false);
  });
});

describe('revoked permission', () => {
  test('the option is turned off once, the queue is dropped and nothing is recorded', async () => {
    const attempts: string[] = [];
    const h = harness({
      copy: async (id) => {
        attempts.push(id);
        throw coded('ERR_FOLDER_ACCESS');
      },
    });
    h.copier.enqueue('a');
    h.copier.enqueue('b');
    await h.copier.idle();
    assert.deepEqual(attempts, ['a']);
    assert.equal(h.events.filter((event) => event === 'access-lost').length, 1);
    assert.deepEqual(h.records, {});
    assert.equal(h.copier.enqueue('c'), false);
  });
});

describe('dispose', () => {
  test('a disposed copier (Fast Refresh) starts nothing new', async () => {
    const h = harness();
    h.copier.dispose();
    assert.equal(h.copier.enqueue('a'), false);
    await h.copier.idle();
    assert.equal(h.calls.length, 0);
  });
});

describe('copyFolderLabel', () => {
  test('joins the folder name and subfolders, skipping blanks', () => {
    assert.equal(copyFolderLabel('Movies', ['Videos']), 'Movies/Videos');
    assert.equal(copyFolderLabel(null, []), null);
    assert.equal(copyFolderLabel(null, ['Audio']), 'Audio');
  });
});
