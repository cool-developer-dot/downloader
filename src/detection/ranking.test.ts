import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ACTIVE_WINDOW_MS, rankTabItems } from './ranking.ts';
import { changeUrl, markActivity, startDocument, upsertCandidate, type TabState } from './tab-state.ts';
import type { CandidateSource, PageCandidate, PlayerHint } from './types.ts';

const FEED = 'https://www.instagram.com/';
const origin = { frameUrl: FEED, userAgent: 'UA' };

function candidate(key: string, sources: CandidateSource[], extra: Partial<PageCandidate> = {}): PageCandidate {
  return { key, site: 'instagram', provenance: 'json', sources, ...extra };
}

function progressive(name: string, extra: Partial<Extract<CandidateSource, { kind: 'progressive' }>> = {}): CandidateSource {
  return { kind: 'progressive', url: `https://cdn.example.com/${name}.mp4`, ...extra };
}

function keys(tab: TabState, now = 10_000): string[] {
  return rankTabItems(tab, now).map((item) => item.key);
}

function withPlayers(tab: TabState, players: PlayerHint[]): TabState {
  return { ...tab, players: { [tab.currentUrl]: players } };
}

describe('rankTabItems', () => {
  test('the item for the current page ranks first, by contentUrl or by asset id in the URL', () => {
    let tab = startDocument(undefined, FEED);
    tab = upsertCandidate(tab, candidate('instagram:AAAAA', [progressive('a', { height: 1920, hasAudio: true })]), origin, 1);
    tab = upsertCandidate(
      tab,
      candidate('instagram:BBBBB', [progressive('b', { height: 480 })], { contentUrl: 'https://www.instagram.com/reel/BBBBB/' }),
      origin,
      2,
    );
    tab = upsertCandidate(tab, candidate('instagram:CCCCC', [progressive('c', { height: 720 })]), origin, 3);

    assert.equal(keys(changeUrl(tab, 'https://www.instagram.com/reel/BBBBB/?igsh=x'))[0], 'instagram:BBBBB');
    assert.equal(keys(changeUrl(tab, 'https://www.instagram.com/reels/CCCCC/'))[0], 'instagram:CCCCC');
  });

  test('a url: item matches when the tab shows that media URL directly', () => {
    let tab = startDocument(undefined, 'https://cdn.example.com/b.mp4?sig=1');
    tab = upsertCandidate(tab, candidate('instagram:AAAAA', [progressive('a', { height: 2160, hasAudio: true })]), origin, 1);
    tab = upsertCandidate(tab, { key: 'url:https://cdn.example.com/b.mp4', site: 'web', provenance: 'dom', sources: [progressive('b')] }, origin, 2);
    assert.equal(keys(tab)[0], 'url:https://cdn.example.com/b.mp4');
  });

  test('playing beats visible beats neither: by player src, poster, blob duration or network activity', () => {
    let tab = startDocument(undefined, FEED);
    tab = upsertCandidate(tab, candidate('instagram:Idle1', [progressive('idle', { height: 1080, hasAudio: true })]), origin, 5);
    tab = upsertCandidate(tab, candidate('instagram:Seen1', [progressive('seen')], { thumbnailUrl: 'https://cdn.example.com/seen.jpg' }), origin, 1);
    tab = upsertCandidate(tab, candidate('instagram:Play1', [progressive('play')], { durationSec: 15.02 }), origin, 1);

    const visibleByPoster: PlayerHint = { isBlob: false, playing: false, visibleRatio: 0.8, poster: 'https://cdn.example.com/seen.jpg' };
    const playingBlob: PlayerHint = { isBlob: true, playing: true, visibleRatio: 1, durationSec: 15 };
    assert.deepEqual(keys(withPlayers(tab, [visibleByPoster, playingBlob])), ['instagram:Play1', 'instagram:Seen1', 'instagram:Idle1']);

    const playingBySrc: PlayerHint = { isBlob: false, playing: true, visibleRatio: 1, src: 'https://cdn.example.com/seen.mp4' };
    assert.equal(keys(withPlayers(tab, [playingBySrc]))[0], 'instagram:Seen1');

    const offscreenPaused: PlayerHint = { isBlob: false, playing: false, visibleRatio: 0.1, src: 'https://cdn.example.com/seen.mp4' };
    assert.equal(keys(withPlayers(tab, [offscreenPaused]))[0], 'instagram:Idle1');

    const active = markActivity(tab, 'https://cdn.example.com/play.mp4', 9_000);
    assert.equal(keys(active, 9_000 + ACTIVE_WINDOW_MS)[0], 'instagram:Play1');
    assert.equal(keys(active, 9_001 + ACTIVE_WINDOW_MS)[0], 'instagram:Idle1');
  });

  test('then audio, height, bitrate and recency', () => {
    let tab = startDocument(undefined, FEED);
    tab = upsertCandidate(tab, candidate('instagram:Silent', [progressive('s', { height: 2160, hasAudio: false })]), origin, 9);
    tab = upsertCandidate(tab, candidate('instagram:Unknown', [progressive('u', { height: 2160 })]), origin, 8);
    tab = upsertCandidate(tab, candidate('instagram:Low', [progressive('l', { height: 480, hasAudio: true })]), origin, 7);
    tab = upsertCandidate(tab, candidate('instagram:HighOld', [progressive('h1', { height: 1080, hasAudio: true, bitrate: 1 })]), origin, 1);
    tab = upsertCandidate(tab, candidate('instagram:HighNew', [progressive('h2', { height: 1080, hasAudio: true, bitrate: 1 })]), origin, 2);
    tab = upsertCandidate(tab, candidate('instagram:HighRate', [progressive('h3', { height: 1080, audioUrl: 'https://cdn.example.com/a.m4a', bitrate: 5 })]), origin, 0);
    tab = upsertCandidate(tab, candidate('instagram:Stream', [{ kind: 'hls', url: 'https://cdn.example.com/m.m3u8', height: 720 }]), origin, 0);

    assert.deepEqual(keys(tab), [
      'instagram:HighRate',
      'instagram:HighNew',
      'instagram:HighOld',
      'instagram:Stream',
      'instagram:Low',
      'instagram:Unknown',
      'instagram:Silent',
    ]);
  });
});
