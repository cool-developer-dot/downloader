import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checkLinks, checkOne, classifyResponse, sameAddress } from './link-check.ts';

type Init = { method: string; credentials: string; signal: AbortSignal };

describe('B9 #91 link check', () => {
  test('classification: works, moved (new address offered), not found, unreachable', () => {
    assert.deepEqual(classifyResponse('https://a.test/x', 200, 'https://a.test/x'), { status: 'works', newUrl: null });
    assert.deepEqual(classifyResponse('https://a.test/x', 200, 'https://www.a.test/x/'), { status: 'works', newUrl: null });
    assert.deepEqual(classifyResponse('http://a.test/x', 200, 'https://b.test/y'), { status: 'moved', newUrl: 'https://b.test/y' });
    assert.equal(classifyResponse('https://a.test/x', 404, null).status, 'notFound');
    assert.equal(classifyResponse('https://a.test/x', 410, null).status, 'notFound');
    assert.equal(classifyResponse('https://a.test/x', 403, null).status, 'works');
    assert.equal(classifyResponse('https://a.test/x', 503, null).status, 'unreachable');
    assert.equal(sameAddress('https://a.test/p#top', 'https://A.test/p'), true);
    assert.equal(sameAddress('https://a.test/p?x=1', 'https://a.test/p?x=2'), false);
  });

  test('no cookies, HEAD first and GET when HEAD is refused; a network error is unreachable', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: Init) => {
      calls.push(`${init.method} ${init.credentials}`);
      return init.method === 'HEAD' ? { status: 405, url } : { status: 200, url };
    };
    assert.equal((await checkOne({ id: '1', url: 'https://a.test/' }, fetchImpl)).status, 'works');
    assert.deepEqual(calls, ['HEAD omit', 'GET omit']);
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    assert.equal((await checkOne({ id: '2', url: 'https://gone.test/' }, failing)).status, 'unreachable');
  });

  test('a link that never answers times out as unreachable', async () => {
    const hang = (_url: string, init: Init) =>
      new Promise<{ status: number; url: string }>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    const result = await checkOne({ id: '3', url: 'https://slow.test/' }, hang, { timeoutMs: 30 });
    assert.equal(result.status, 'unreachable');
    assert.ok(Date.now() - started < 1000);
  });

  test('at most 4 at a time; progress for each; Cancel stops and returns what was done', async () => {
    let running = 0;
    let peak = 0;
    const fetchImpl = async (url: string) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return { status: 200, url };
    };
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, url: `https://s${i}.test/` }));
    const progress: number[] = [];
    const results = await checkLinks(items, fetchImpl, { onResult: (_r, done) => progress.push(done) });
    assert.equal(results.length, 12);
    assert.equal(peak, 4);
    assert.deepEqual(progress, Array.from({ length: 12 }, (_, i) => i + 1));

    const controller = new AbortController();
    const partial = await checkLinks(items, fetchImpl, {
      signal: controller.signal,
      onResult: (_r, done) => {
        if (done === 2) controller.abort();
      },
    });
    assert.ok(partial.length < 12);
  });
});
