import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RemoteLinkRequest } from '@modules/vidorax-media/src/VidoraRemote.types';

import { createLinkIntakeQueue, type IntakeResult } from './link-intake-queue';

const request = (id: string, url = `https://example.com/${id}.mp4`): RemoteLinkRequest => ({
  requestId: id,
  url,
  source: 'web',
  createdAt: 1,
});

describe('remote link intake (P6)', () => {
  it('checks links one at a time and reports each outcome', async () => {
    const order: string[] = [];
    let active = 0;
    const reports: unknown[][] = [];
    const queue = createLinkIntakeQueue({
      addLink: async (url): Promise<IntakeResult> => {
        active += 1;
        assert.equal(active, 1, 'never two checks at once');
        order.push(url);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { outcome: 'added', title: 'Video', downloadId: `d-${order.length}`, detail: 'ENQUEUED' };
      },
      report: async (...args) => {
        reports.push(args);
      },
    });
    queue.enqueue(request('a'));
    queue.enqueue(request('b'));
    await queue.whenIdle();
    assert.deepEqual(order, ['https://example.com/a.mp4', 'https://example.com/b.mp4']);
    assert.deepEqual(reports, [
      ['a', 'added', 'Video', 'd-1', 'ENQUEUED'],
      ['b', 'added', 'Video', 'd-2', 'ENQUEUED'],
    ]);
  });

  it('checks a request handed over twice only once', async () => {
    let checks = 0;
    const queue = createLinkIntakeQueue({
      addLink: async () => {
        checks += 1;
        return { outcome: 'duplicate', title: null, downloadId: 'd', detail: 'ALREADY' };
      },
      report: async () => undefined,
    });
    queue.enqueue(request('same'));
    queue.enqueue(request('same'));
    await queue.whenIdle();
    queue.enqueue(request('same'));
    await queue.whenIdle();
    assert.equal(checks, 1);
  });

  it('reports a failed or slow check as needs review and goes on', async () => {
    const reports: unknown[][] = [];
    const queue = createLinkIntakeQueue({
      timeoutMs: 10,
      addLink: (url, signal) =>
        url.includes('throws')
          ? Promise.reject(new Error('boom'))
          : new Promise((resolve) => {
              signal.addEventListener('abort', () =>
                resolve({ outcome: 'needs-review', title: null, downloadId: null, detail: 'STALE' }),
              );
            }),
      report: async (...args) => {
        reports.push(args);
      },
    });
    queue.enqueue(request('throws'));
    queue.enqueue(request('slow'));
    await queue.whenIdle();
    assert.deepEqual(reports, [
      ['throws', 'needs-review', null, null, 'ERROR'],
      ['slow', 'needs-review', null, null, 'STALE'],
    ]);
  });

  it('keeps going when the phone cannot take a report', async () => {
    let checks = 0;
    const queue = createLinkIntakeQueue({
      addLink: async () => {
        checks += 1;
        return { outcome: 'refused', title: null, downloadId: null, detail: 'YOUTUBE' };
      },
      report: () => Promise.reject(new Error('server gone')),
    });
    queue.enqueue(request('x'));
    queue.enqueue(request('y'));
    await queue.whenIdle();
    assert.equal(checks, 2);
  });
});
