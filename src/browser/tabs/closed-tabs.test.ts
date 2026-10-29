import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_CLOSED_TABS,
  pushClosedTabs,
  sanitizeClosedTabs,
  takeClosedBatch,
  takeLatestClosed,
  type ClosedTabEntry,
} from './closed-tabs.ts';

const HOME = 'vidorax://home';

function entry(id: string, extra: Partial<ClosedTabEntry> = {}): ClosedTabEntry {
  return {
    id,
    url: `https://${id}.example/`,
    title: id,
    index: 0,
    pinned: false,
    desktopMode: false,
    desktopModeSource: 'default',
    createdAt: 1,
    closedAt: 100,
    batchId: id,
    ...extra,
  };
}

describe('closed-tab stack (#3)', () => {
  test('keeps the newest 10', () => {
    let stack: ClosedTabEntry[] = [];
    for (let i = 0; i < 14; i += 1) {
      stack = pushClosedTabs(stack, [entry(`t${i}`, { closedAt: i })]);
    }
    assert.equal(stack.length, MAX_CLOSED_TABS);
    assert.equal(stack[0]!.id, 't13');
    assert.equal(stack[9]!.id, 't4');
  });

  test('a batch is kept together and undone together', () => {
    let stack = pushClosedTabs([], [entry('old', { closedAt: 1 })]);
    stack = pushClosedTabs(stack, [
      entry('c', { index: 3, batchId: 'B', closedAt: 5 }),
      entry('a', { index: 1, batchId: 'B', closedAt: 5 }),
    ]);
    assert.deepEqual(stack.map((e) => e.id), ['a', 'c', 'old']);
    const { taken, stack: rest } = takeClosedBatch(stack, 'B');
    assert.deepEqual(taken.map((e) => e.id), ['a', 'c']);
    assert.deepEqual(rest.map((e) => e.id), ['old']);
  });

  test('reopen takes the most recently closed tab', () => {
    const stack = pushClosedTabs(pushClosedTabs([], [entry('x', { closedAt: 1 })]), [entry('y', { closedAt: 2 })]);
    const first = takeLatestClosed(stack);
    assert.equal(first.taken?.id, 'y');
    const second = takeLatestClosed(first.stack);
    assert.equal(second.taken?.id, 'x');
    assert.equal(takeLatestClosed(second.stack).taken, null);
  });

  test('position and pinned survive a round trip through storage', () => {
    const stored = JSON.parse(
      JSON.stringify({ version: 1, entries: [entry('p', { index: 4, pinned: true, desktopMode: true })] }),
    );
    const [back] = sanitizeClosedTabs(stored, HOME);
    assert.equal(back!.index, 4);
    assert.equal(back!.pinned, true);
    assert.equal(back!.desktopMode, true);
  });

  test('broken or unsafe stored entries are dropped', () => {
    const raw = {
      entries: [
        entry('ok'),
        { id: '', url: 'https://x.example' },
        { id: 'js', url: 'javascript:alert(1)' },
        { id: 'file', url: 'file:///sdcard/a' },
        entry('ok'),
        { id: 'home', url: HOME },
        'garbage',
      ],
    };
    assert.deepEqual(sanitizeClosedTabs(raw, HOME).map((e) => e.id), ['ok', 'home']);
    assert.deepEqual(sanitizeClosedTabs(null, HOME), []);
    assert.deepEqual(sanitizeClosedTabs({ entries: 'x' }, HOME), []);
  });
});
