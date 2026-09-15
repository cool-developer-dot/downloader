import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_ITEMS_PER_TAB,
  applyMessage,
  changeUrl,
  markActivity,
  setItemAvailability,
  startDocument,
  upsertCandidate,
  type TabState,
} from './tab-state.ts';
import type { DetectorMessage, PageCandidate } from './types.ts';

const PAGE = 'https://www.instagram.com/reel/C9xYz/';
const mainFrame = { url: PAGE, isMain: true, userAgent: 'UA-main' };
const origin = { frameUrl: PAGE, userAgent: 'UA-main' };

function tab(): TabState {
  return startDocument(undefined, PAGE);
}

function reel(overrides: Partial<PageCandidate> = {}): PageCandidate {
  return {
    key: 'instagram:C9xYz',
    site: 'instagram',
    title: 'Reel title',
    thumbnailUrl: 'https://scontent.cdninstagram.com/thumb.jpg',
    durationSec: 12,
    contentUrl: PAGE,
    provenance: 'json',
    sources: [{ kind: 'progressive', url: 'https://scontent.cdninstagram.com/v/a.mp4?oh=1&oe=2', height: 1280, hasAudio: true }],
    ...overrides,
  };
}

function message(fields: Record<string, unknown>): DetectorMessage {
  return { ch: 'vdx', v: 1, frame: mainFrame, ...fields } as DetectorMessage;
}

describe('document lifecycle', () => {
  test('startDocument clears items and flags, bumps documentId and keeps the tab User-Agent', () => {
    let state = applyMessage(tab(), message({ type: 'hello' }), 1);
    state = upsertCandidate(state, reel(), origin, 1);
    state = applyMessage(state, message({ type: 'drm', keySystem: 'com.widevine.alpha' }), 2);
    const next = startDocument(state, 'https://www.tiktok.com/');
    assert.deepEqual(next.order, []);
    assert.deepEqual(next.items, {});
    assert.equal(next.drmDetected, false);
    assert.equal(next.documentId, state.documentId + 1);
    assert.equal(next.userAgent, 'UA-main');
    assert.equal(next.documentUrl, 'https://www.tiktok.com/');
  });

  test('startDocument on YouTube marks the tab policy-blocked immediately', () => {
    assert.equal(startDocument(undefined, 'https://m.youtube.com/').policyBlocked, 'youtube');
  });

  test('changeUrl only updates currentUrl and keeps items', () => {
    const state = upsertCandidate(tab(), reel(), origin, 1);
    const next = changeUrl(state, 'https://www.instagram.com/reel/Other/');
    assert.equal(next.currentUrl, 'https://www.instagram.com/reel/Other/');
    assert.equal(next.documentUrl, PAGE);
    assert.equal(next.items, state.items);
    assert.equal(changeUrl(next, next.currentUrl), next);
  });

  test('main-frame nav updates URL and title; sub-frame nav is ignored', () => {
    const state = applyMessage(tab(), message({ type: 'nav', url: 'https://www.instagram.com/p/X/', title: 'Post' }), 1);
    assert.equal(state.currentUrl, 'https://www.instagram.com/p/X/');
    assert.equal(state.pageTitle, 'Post');
    const frameNav = { ...message({ type: 'nav', url: 'https://player.vimeo.com/video/1' }), frame: { ...mainFrame, isMain: false } };
    assert.equal(applyMessage(state, frameNav as DetectorMessage, 2), state);
  });

  test('drm and policy flags are set once', () => {
    const state = applyMessage(tab(), message({ type: 'drm', keySystem: 'com.widevine.alpha' }), 1);
    assert.equal(state.drmDetected, true);
    assert.equal(applyMessage(state, message({ type: 'drm', keySystem: 'x' }), 2), state);
    assert.equal(applyMessage(state, message({ type: 'policy', blocked: 'youtube' }), 3).policyBlocked, 'youtube');
  });
});

describe('candidate merging', () => {
  test('merges by key: unions sources, keeps firstSeenAt, bumps lastSeenAt', () => {
    let state = upsertCandidate(tab(), reel(), origin, 100);
    state = upsertCandidate(
      state,
      reel({ sources: [{ kind: 'dash', url: PAGE, manifestText: '<MPD/>' }] }),
      origin,
      200,
    );
    const item = state.items['instagram:C9xYz'];
    assert.equal(state.order.length, 1);
    assert.equal(item.sources.length, 2);
    assert.equal(item.firstSeenAt, 100);
    assert.equal(item.lastSeenAt, 200);
  });

  test('metadata from a more trustworthy provenance wins; weaker provenance only fills gaps', () => {
    let state = upsertCandidate(tab(), reel({ provenance: 'dom', title: 'og title', durationSec: undefined }), origin, 1);
    state = upsertCandidate(state, reel({ provenance: 'json', title: 'JSON title' }), origin, 2);
    assert.equal(state.items['instagram:C9xYz'].title, 'JSON title');
    state = upsertCandidate(state, reel({ provenance: 'dom', title: 'late og title', durationSec: 99 }), origin, 3);
    assert.equal(state.items['instagram:C9xYz'].title, 'JSON title');
    assert.equal(state.items['instagram:C9xYz'].durationSec, 12);
    assert.equal(state.items['instagram:C9xYz'].provenance, 'json');
  });

  test('url: keys are canonicalized so chunked or re-signed URLs group together', () => {
    const url = (query: string) => `https://cdn.example.com/v/clip.mp4?${query}`;
    let state = upsertCandidate(
      tab(),
      { key: `url:${url('sig=1&bytestart=0&byteend=10')}`, site: 'web', provenance: 'dom', sources: [{ kind: 'progressive', url: url('sig=1') }] },
      origin,
      1,
    );
    state = upsertCandidate(
      state,
      { key: `url:${url('sig=2')}`, site: 'web', provenance: 'dom', sources: [{ kind: 'progressive', url: url('sig=2') }] },
      origin,
      2,
    );
    assert.deepEqual(state.order, ['url:https://cdn.example.com/v/clip.mp4']);
    assert.equal(state.items[state.order[0]].sources[0].url, url('sig=2'), 'fresher signed URL wins');
  });

  test('a site candidate absorbs url: items that share a source', () => {
    const networkUrl = 'https://scontent.cdninstagram.com/v/a.mp4?oh=9&oe=9';
    let state = upsertCandidate(
      tab(),
      { key: `url:${networkUrl}`, site: 'instagram', provenance: 'network', sources: [{ kind: 'progressive', url: networkUrl }] },
      { frameUrl: PAGE, userAgent: '' },
      50,
    );
    state = markActivity(state, networkUrl, 60);
    state = upsertCandidate(state, reel(), origin, 100);
    assert.deepEqual(state.order, ['instagram:C9xYz']);
    const item = state.items['instagram:C9xYz'];
    assert.equal(item.firstSeenAt, 50);
    assert.equal(item.activeAt, 60);
    assert.equal(item.title, 'Reel title');
    assert.equal(item.sources.length, 1);
  });

  test('a url: candidate for media a site item owns merges into that item', () => {
    let state = upsertCandidate(tab(), reel(), origin, 1);
    state = upsertCandidate(
      state,
      {
        key: 'url:https://scontent.cdninstagram.com/v/a.mp4',
        site: 'instagram',
        provenance: 'network',
        sources: [{ kind: 'progressive', url: 'https://scontent.cdninstagram.com/v/a.mp4?oh=3&oe=4' }],
      },
      { frameUrl: PAGE, userAgent: '' },
      2,
    );
    assert.deepEqual(state.order, ['instagram:C9xYz']);
    assert.equal(state.items['instagram:C9xYz'].provenance, 'json');
    const [source] = state.items['instagram:C9xYz'].sources;
    assert.equal(source.kind === 'progressive' ? source.hasAudio : undefined, true, 'known fields survive a sparse re-sighting');
  });

  test('drops policy-blocked sources and candidates left without sources', () => {
    const state = upsertCandidate(
      tab(),
      reel({ key: 'web:yt', sources: [{ kind: 'progressive', url: 'https://r1.googlevideo.com/videoplayback?itag=18' }] }),
      origin,
      1,
    );
    assert.deepEqual(state.order, []);
  });

  test('evicts the least recently seen item beyond the cap; re-sighting moves an item to the end', () => {
    let state = tab();
    for (let index = 0; index <= MAX_ITEMS_PER_TAB; index += 1) {
      state = upsertCandidate(
        state,
        reel({ key: `instagram:Clip${index}`, sources: [{ kind: 'progressive', url: `https://cdn.example.com/${index}.mp4` }] }),
        origin,
        index,
      );
      if (index === 5) {
        state = upsertCandidate(state, reel({ key: 'instagram:Clip0', sources: [{ kind: 'progressive', url: 'https://cdn.example.com/0.mp4' }] }), origin, index);
      }
    }
    assert.equal(state.order.length, MAX_ITEMS_PER_TAB);
    assert.equal(Object.keys(state.items).length, MAX_ITEMS_PER_TAB);
    assert.equal(state.items['instagram:Clip1'], undefined);
    assert.ok(state.items['instagram:Clip0']);
    assert.equal(state.order.at(-1), `instagram:Clip${MAX_ITEMS_PER_TAB}`);
  });
});

describe('availability and revisions', () => {
  test('new sources bump the revision and reset availability; URL-only refreshes keep it', () => {
    let state = upsertCandidate(tab(), reel(), origin, 1);
    state = setItemAvailability(state, 'instagram:C9xYz', 0, { status: 'ready', options: [] });
    state = upsertCandidate(
      state,
      reel({ sources: [{ kind: 'progressive', url: 'https://scontent.cdninstagram.com/v/a.mp4?oh=5&oe=6', height: 1280, hasAudio: true }] }),
      origin,
      2,
    );
    assert.equal(state.items['instagram:C9xYz'].revision, 0);
    assert.equal(state.items['instagram:C9xYz'].availability.status, 'ready');

    state = upsertCandidate(state, reel({ sources: [{ kind: 'hls', url: 'https://cdn.example.com/master.m3u8' }] }), origin, 3);
    assert.equal(state.items['instagram:C9xYz'].revision, 1);
    assert.equal(state.items['instagram:C9xYz'].availability.status, 'unresolved');
  });

  test('setItemAvailability ignores stale revisions and missing items', () => {
    const state = upsertCandidate(tab(), reel(), origin, 1);
    assert.equal(setItemAvailability(state, 'instagram:C9xYz', 7, { status: 'resolving' }), state);
    assert.equal(setItemAvailability(state, 'missing', 0, { status: 'resolving' }), state);
  });
});

describe('players and activity', () => {
  test('keeps the latest players per frame, removes empty lists and caps frames', () => {
    const player = { isBlob: true, playing: true, visibleRatio: 1 };
    let state = applyMessage(tab(), message({ type: 'players', players: [player] }), 1);
    assert.deepEqual(state.players, { [PAGE]: [player] });
    state = applyMessage(state, message({ type: 'players', players: [] }), 2);
    assert.deepEqual(state.players, {});
    assert.equal(applyMessage(state, message({ type: 'players', players: [] }), 3), state);

    for (let index = 0; index < 12; index += 1) {
      const frameMessage = { ...message({ type: 'players', players: [player] }), frame: { ...mainFrame, url: `https://f${index}.example.com/` } };
      state = applyMessage(state, frameMessage as DetectorMessage, index);
    }
    assert.equal(Object.keys(state.players).length, 8);
    assert.ok(state.players['https://f11.example.com/']);
  });

  test('markActivity matches progressive files by grouping key and segments by manifest directory', () => {
    let state = upsertCandidate(tab(), reel(), origin, 1);
    state = upsertCandidate(
      state,
      { key: 'url:https://cdn.example.com/vod/1/master.m3u8', site: 'web', provenance: 'network', sources: [{ kind: 'hls', url: 'https://cdn.example.com/vod/1/master.m3u8' }] },
      origin,
      1,
    );
    state = markActivity(state, 'https://scontent.cdninstagram.com/v/a.mp4?oh=7', 10);
    assert.equal(state.items['instagram:C9xYz'].activeAt, 10);
    state = markActivity(state, 'https://cdn.example.com/vod/1/720/seg-9.ts', 20);
    assert.equal(state.items['url:https://cdn.example.com/vod/1/master.m3u8'].activeAt, 20);
    assert.equal(markActivity(state, 'https://unrelated.example.com/x.ts', 30), state);
  });
});
