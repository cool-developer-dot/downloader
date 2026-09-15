import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createResolver, resolveItem, type ResolverDeps } from './resolve.ts';
import { setItemAvailability, startDocument, upsertCandidate, type TabState } from './tab-state.ts';
import type { ItemAvailability, PageCandidate } from './types.ts';

const PAGE = 'https://www.example.com/watch/1';
const labels = { original: 'Original', noAudio: 'No audio', watermark: 'Watermark' };

function ok(overrides: Partial<Extract<ProbeResult, { ok: true }>> = {}): ProbeResult {
  return {
    ok: true,
    kind: 'progressive',
    finalUrl: 'https://cdn.example.com/x',
    contentType: 'video/mp4',
    container: 'mp4',
    sizeBytes: 1_000_000,
    resumable: true,
    variants: [],
    audioTracks: [],
    durationMs: null,
    ...overrides,
  };
}

const candidate: PageCandidate = {
  key: 'web:clip1',
  site: 'web',
  provenance: 'json',
  sources: [
    { kind: 'progressive', url: 'https://cdn.example.com/720.mp4', height: 720, hasAudio: true },
    { kind: 'progressive', url: 'https://cdn.example.com/expired.mp4', height: 1080, hasAudio: true },
    { kind: 'hls', url: 'https://cdn.example.com/master.m3u8' },
  ],
};

function probeTable(table: Record<string, ProbeResult | Error>) {
  const calls: ProbeRequest[] = [];
  const probe = async (request: ProbeRequest): Promise<ProbeResult> => {
    calls.push(request);
    const result = table[request.url];
    if (result instanceof Error) throw result;
    return result ?? { ok: false, reason: 'HTTP_404', httpStatus: 404, message: null };
  };
  return { probe, calls };
}

function tabWith(candidateToAdd: PageCandidate = candidate): TabState {
  return upsertCandidate(startDocument(undefined, PAGE), candidateToAdd, { frameUrl: PAGE, userAgent: 'UA' }, 1);
}

describe('resolveItem', () => {
  test('probes every source, merges their options and ranks them', async () => {
    const { probe, calls } = probeTable({
      'https://cdn.example.com/720.mp4': ok({ sizeBytes: 20_000_000 }),
      'https://cdn.example.com/master.m3u8': ok({
        kind: 'hls',
        variants: [
          { id: 'hd', width: 1920, height: 1080, bitrate: 4_000_000, frameRate: 30, videoCodec: 'avc1', needsAudioMux: true, estimatedBytes: 60_000_000, decodable: true },
        ],
      }),
    });
    const tab = tabWith();
    const result = await resolveItem(tab.items['web:clip1'], { currentUrl: PAGE, pageTitle: null, userAgent: null, date: new Date() }, probe, labels);
    assert.equal(calls.length, 3);
    assert.equal(result.status, 'ready');
    assert.deepEqual(
      result.status === 'ready' ? result.options.map((option) => `${option.label} ${option.detail}`) : [],
      ['1080p MP4 · 60 MB', '720p MP4 · 20 MB'],
    );
  });

  test('reports the most specific failure, including thrown native errors', async () => {
    const policy = Object.assign(new Error('blocked'), { code: 'ERR_POLICY_BLOCKED' });
    const { probe } = probeTable({
      'https://cdn.example.com/720.mp4': { ok: false, reason: 'NOT_MEDIA', httpStatus: 200, message: null },
      'https://cdn.example.com/master.m3u8': policy,
    });
    const result = await resolveItem(tabWith().items['web:clip1'], { currentUrl: PAGE, pageTitle: null, userAgent: null, date: new Date() }, probe, labels);
    assert.deepEqual(result, { status: 'unsupported', reason: 'POLICY_BLOCKED' });
  });
});

describe('createResolver', () => {
  function harness(probe: ResolverDeps['probe']) {
    const tabs = new Map<string, TabState>([['t1', tabWith()]]);
    const writes: ItemAvailability['status'][] = [];
    const resolver = createResolver({
      probe,
      getTab: (tabId) => tabs.get(tabId),
      setAvailability: (tabId, documentId, key, revision, availability) => {
        const tab = tabs.get(tabId);
        if (tab && tab.documentId === documentId) {
          writes.push(availability.status);
          tabs.set(tabId, setItemAvailability(tab, key, revision, availability));
        }
      },
      labels: () => labels,
      now: () => new Date(2026, 0, 1),
    });
    return { tabs, writes, resolver };
  }

  test('marks resolving, stores the result, and serves it from the store afterwards', async () => {
    const { probe, calls } = probeTable({ 'https://cdn.example.com/720.mp4': ok() });
    const { tabs, writes, resolver } = harness(probe);
    const [first, second] = await Promise.all([resolver.ensureResolved('t1', 'web:clip1'), resolver.ensureResolved('t1', 'web:clip1')]);
    assert.equal(first?.status, 'ready');
    assert.equal(second, first, 'concurrent callers share one resolution');
    assert.deepEqual(writes, ['resolving', 'ready']);
    assert.equal(tabs.get('t1')?.items['web:clip1'].availability, first);

    await resolver.ensureResolved('t1', 'web:clip1');
    assert.equal(calls.length, 3, 'cached: no new probes');
    await resolver.refresh('t1', 'web:clip1');
    assert.equal(calls.length, 6, 'refresh probes again');
  });

  test('drops the result when a new document started meanwhile', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tabs, resolver } = harness(async () => {
      await gate;
      return ok();
    });
    const pending = resolver.ensureResolved('t1', 'web:clip1');
    tabs.set('t1', startDocument(tabs.get('t1'), 'https://www.example.com/next'));
    release();
    assert.equal(await pending, null);
    assert.deepEqual(tabs.get('t1')?.order, []);
  });

  test('returns null for unknown tabs and items', async () => {
    const { resolver } = harness(async () => ok());
    assert.equal(await resolver.ensureResolved('nope', 'web:clip1'), null);
    assert.equal(await resolver.ensureResolved('t1', 'web:missing'), null);
  });
});
