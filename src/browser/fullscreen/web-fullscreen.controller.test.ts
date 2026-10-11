import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWebFullscreenController } from './web-fullscreen.controller';

function setup() {
  const calls: string[] = [];
  const controller = createWebFullscreenController({
    lockOrientation: (orientation) => {
      calls.push(`lock:${orientation}`);
    },
    restoreOrientation: () => {
      calls.push('restore');
    },
    requestPageExit: (tabId) => {
      calls.push(`exit:${tabId}`);
    },
  });
  let notified = 0;
  controller.subscribe(() => {
    notified += 1;
  });
  return { controller, calls, notified: () => notified };
}

const WIDE = { width: 1280, height: 720 };
const TALL = { width: 720, height: 1280 };

test('entering fullscreen on the active tab locks the orientation the video needs', () => {
  const { controller, calls, notified } = setup();
  controller.onPageReport('a', true, { active: true, size: WIDE });
  assert.deepEqual(calls, ['lock:landscape']);
  assert.deepEqual(controller.getState(), { tabId: 'a', orientation: 'landscape' });
  assert.equal(controller.isFullscreen(), true);
  assert.equal(notified(), 1);

  const tall = setup();
  tall.controller.onPageReport('a', true, { active: true, size: TALL });
  assert.deepEqual(tall.calls, ['lock:portrait']);
});

test('an unknown size locks landscape, and a later size re-decides once', () => {
  const { controller, calls } = setup();
  controller.onPageReport('a', true, { active: true, size: null });
  controller.onPageReport('a', true, { active: true, size: TALL });
  controller.onPageReport('a', true, { active: true, size: { width: 360, height: 640 } });
  assert.deepEqual(calls, ['lock:landscape', 'lock:portrait']);
  assert.equal(controller.getState().orientation, 'portrait');
});

test('leaving fullscreen in the page restores portrait', () => {
  const { controller, calls } = setup();
  controller.onPageReport('a', true, { active: true, size: WIDE });
  controller.onPageReport('a', true, { active: false, size: null });
  assert.deepEqual(calls, ['lock:landscape', 'restore']);
  assert.deepEqual(controller.getState(), { tabId: null, orientation: null });
  // A repeated exit report changes nothing.
  controller.onPageReport('a', true, { active: false, size: null });
  assert.deepEqual(calls, ['lock:landscape', 'restore']);
});

test('a parked tab cannot cover the app: it is told to leave and nothing turns', () => {
  const { controller, calls } = setup();
  controller.onPageReport('parked', false, { active: true, size: WIDE });
  assert.deepEqual(calls, ['exit:parked']);
  assert.equal(controller.isFullscreen(), false);
  // Its exit report afterwards restores nothing either.
  controller.onPageReport('parked', false, { active: false, size: null });
  assert.deepEqual(calls, ['exit:parked']);
});

test('leave asks the page to exit and restores portrait at once (Back is consumed)', () => {
  const { controller, calls } = setup();
  assert.equal(controller.leave('back'), false);
  assert.deepEqual(calls, []);

  controller.onPageReport('a', true, { active: true, size: WIDE });
  assert.equal(controller.leave('back'), true);
  assert.deepEqual(calls, ['lock:landscape', 'restore', 'exit:a']);
  assert.equal(controller.isFullscreen(), false);
  // The page's own exit report arrives later: no second restore.
  controller.onPageReport('a', true, { active: false, size: null });
  assert.deepEqual(calls, ['lock:landscape', 'restore', 'exit:a']);
  // A page that never answers does not trap the next Back.
  assert.equal(controller.leave('back'), false);
});

test('switching to another tab takes the fullscreen tab out of fullscreen', () => {
  const { controller, calls } = setup();
  controller.onPageReport('a', true, { active: true, size: WIDE });
  assert.equal(controller.leaveUnlessActiveTab('a'), false);
  assert.equal(controller.leaveUnlessActiveTab('b'), true);
  assert.deepEqual(calls, ['lock:landscape', 'restore', 'exit:a']);
  assert.equal(controller.leaveUnlessActiveTab('b'), false);
});

test('a page that navigates away, crashes or unmounts while fullscreen restores portrait without an exit request', () => {
  for (const reason of ['navigation', 'render_process_gone', 'unmount'] as const) {
    const { controller, calls } = setup();
    controller.onPageReport('a', true, { active: true, size: WIDE });
    controller.onPageGone('other', reason);
    assert.deepEqual(calls, ['lock:landscape']);
    controller.onPageGone('a', reason);
    assert.deepEqual(calls, ['lock:landscape', 'restore']);
    assert.equal(controller.isFullscreen(), false);
  }
});

test('a second tab entering fullscreen asks the first to leave', () => {
  const { controller, calls } = setup();
  controller.onPageReport('a', true, { active: true, size: WIDE });
  controller.onPageReport('b', true, { active: true, size: TALL });
  assert.deepEqual(calls, ['lock:landscape', 'exit:a', 'lock:portrait']);
  assert.equal(controller.getState().tabId, 'b');
  // a's exit report no longer matters.
  controller.onPageReport('a', false, { active: false, size: null });
  assert.equal(controller.getState().tabId, 'b');
});

test('a failing orientation lock does not break fullscreen handling', async () => {
  const controller = createWebFullscreenController({
    lockOrientation: () => Promise.reject(new Error('no activity')),
    restoreOrientation: () => Promise.reject(new Error('no activity')),
    requestPageExit: () => undefined,
  });
  controller.onPageReport('a', true, { active: true, size: WIDE });
  assert.equal(controller.leave('background'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.isFullscreen(), false);
});
