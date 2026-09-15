import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLegacyMetadata,
  hasLegacyData,
  legacyPageUrl,
  legacySite,
  parseLegacyEngineMap,
  type LegacyCatalogRow,
} from './legacy-metadata.ts';

function row(id: string, overrides: Partial<LegacyCatalogRow> = {}): LegacyCatalogRow {
  return {
    id,
    title: `Title ${id}`,
    source_url: 'https://www.instagram.com/reel/C9xYz/',
    platform: 'instagram',
    status: 'COMPLETED',
    favorite: 0,
    ...overrides,
  };
}

describe('parseLegacyEngineMap', () => {
  test('reads file names, source URLs and completion', () => {
    const records = parseLegacyEngineMap(
      JSON.stringify({
        a: { fileName: 'clip.mp4', sourceUrl: 'https://x.com/i/status/1', localState: 'complete' },
        b: { fileName: 'part.mp4', localState: 'transferring' },
        c: 'garbage',
      }),
    );
    assert.deepEqual([...records.keys()], ['a', 'b']);
    assert.deepEqual(records.get('a'), {
      fileName: 'clip.mp4',
      sourceUrl: 'https://x.com/i/status/1',
      complete: true,
    });
    assert.equal(records.get('b')?.complete, false);
  });

  test('tolerates missing or corrupt storage', () => {
    assert.equal(parseLegacyEngineMap(null).size, 0);
    assert.equal(parseLegacyEngineMap('{not json').size, 0);
    assert.equal(parseLegacyEngineMap('[1,2]').size, 0);
  });
});

describe('legacySite', () => {
  test('prefers the stored platform, case-insensitively', () => {
    assert.equal(legacySite('TIKTOK', 'https://example.com/video'), 'tiktok');
    assert.equal(legacySite('X', null), 'twitter');
  });

  test('falls back to the URL host, including CDNs and subdomains', () => {
    assert.equal(legacySite('', 'https://scontent-lhr8-1.cdninstagram.com/v/t50.mp4'), 'instagram');
    assert.equal(legacySite('OTHER', 'https://v.redd.it/abc/DASH_720.mp4'), 'reddit');
    assert.equal(legacySite('YOUTUBE', 'https://news.example.org/story'), 'web');
  });

  test('does not match prototype keys or look-alike hosts', () => {
    assert.equal(legacySite('constructor', 'https://notinstagram.com/p/1'), 'web');
    assert.equal(legacySite(null, null), undefined);
    assert.equal(legacySite(null, 'file:///data/clip.mp4'), undefined);
  });
});

describe('legacyPageUrl', () => {
  test('keeps page URLs', () => {
    assert.equal(legacyPageUrl('https://www.tiktok.com/@user/video/123'), 'https://www.tiktok.com/@user/video/123');
  });

  test('drops CDN files, manifests and non-http URLs', () => {
    assert.equal(legacyPageUrl('https://v16-webapp.tiktokcdn.com/abc/?mime_type=video_mp4'), undefined);
    assert.equal(legacyPageUrl('https://example.com/stream/master.m3u8'), undefined);
    assert.equal(legacyPageUrl('https://example.com/media/clip.MP4'), undefined);
    assert.equal(legacyPageUrl('blob:https://example.com/123'), undefined);
    assert.equal(legacyPageUrl(null), undefined);
  });
});

describe('buildLegacyMetadata', () => {
  test('maps completed catalog rows to entries', () => {
    const entries = buildLegacyMetadata({
      catalog: [row('a', { favorite: 1 })],
      engine: new Map(),
      favoriteSourceUrls: [],
    });
    assert.deepEqual(entries, [
      {
        id: 'a',
        title: 'Title a',
        site: 'instagram',
        pageUrl: 'https://www.instagram.com/reel/C9xYz/',
        favorite: true,
      },
    ]);
  });

  test('skips unfinished downloads unless the engine finished them', () => {
    const entries = buildLegacyMetadata({
      catalog: [row('queued', { status: 'QUEUED' }), row('stale', { status: 'DOWNLOADING' })],
      engine: new Map([['stale', { fileName: 'stale.mp4', sourceUrl: null, complete: true }]]),
      favoriteSourceUrls: [],
    });
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ['stale'],
    );
  });

  test('uses the engine file name when the catalog has no row or title', () => {
    const entries = buildLegacyMetadata({
      catalog: [row('blank', { title: '  ' })],
      engine: new Map([
        ['blank', { fileName: 'from-engine.webm', sourceUrl: null, complete: true }],
        ['orphan', { fileName: 'Orphan Clip.mp4', sourceUrl: 'https://cdn.example.com/a.mp4', complete: true }],
      ]),
      favoriteSourceUrls: [],
    });
    assert.equal(entries.find((entry) => entry.id === 'blank')?.title, 'Title blank'.trim() === '' ? '' : 'from-engine');
    assert.deepEqual(
      entries.find((entry) => entry.id === 'orphan'),
      { id: 'orphan', title: 'Orphan Clip', site: 'web' },
    );
  });

  test('marks favorites saved by source URL, ignoring fragment and trailing slash', () => {
    const entries = buildLegacyMetadata({
      catalog: [row('a', { source_url: 'https://www.instagram.com/reel/C9xYz/' }), row('b', { source_url: 'https://vimeo.com/1' })],
      engine: new Map(),
      favoriteSourceUrls: ['https://www.instagram.com/reel/C9xYz#comments'],
    });
    assert.equal(entries.find((entry) => entry.id === 'a')?.favorite, true);
    assert.equal(entries.find((entry) => entry.id === 'b')?.favorite, undefined);
  });

  test('empty input builds nothing', () => {
    const empty = { catalog: [], engine: new Map(), favoriteSourceUrls: [] };
    assert.equal(hasLegacyData(empty), false);
    assert.deepEqual(buildLegacyMetadata(empty), []);
  });
});
