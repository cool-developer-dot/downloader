import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { bestInlineDashSource, isoDurationMs, parseInlineDash } from './inline-dash';

const set = (mime: string, reps: string) => `<AdaptationSet mimeType="${mime}">${reps}</AdaptationSet>`;
const rep = (attrs: string, url: string) => `<Representation ${attrs}><BaseURL>${url}</BaseURL></Representation>`;
const mpd = (body: string, attrs = 'type="static" mediaPresentationDuration="PT10.5S"') =>
  `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${attrs}><Period>${body}</Period></MPD>`;

describe('inline DASH manifests on pages', () => {
  test('separate video and audio files make a split pair: best video, best audio', () => {
    const dash = parseInlineDash(
      mpd(
        set('video/mp4', rep('codecs="avc1" width="480" height="854" bandwidth="1"', 'https://c.example/v480.mp4') + rep('codecs="avc1" width="720" height="1280" bandwidth="2"', 'https://c.example/v720.mp4?a=1&amp;b=2')) +
          set('audio/mp4', rep('codecs="mp4a.40.2" bandwidth="64000"', 'https://c.example/a64.mp4') + rep('codecs="mp4a.40.2" bandwidth="128000"', 'https://c.example/a128.mp4')),
      ),
      'https://page.example/',
    );
    assert.ok(dash);
    assert.equal(dash.durationMs, 10_500);
    assert.deepEqual(bestInlineDashSource(dash), { url: 'https://c.example/v720.mp4?a=1&b=2', audioUrl: 'https://c.example/a128.mp4', width: 720, height: 1280, label: null });
  });

  test('a muxed representation is a whole file', () => {
    const dash = parseInlineDash(mpd(set('video/mp4', rep('codecs="avc1.64,mp4a.40.2" height="360"', 'https://c.example/muxed.mp4'))), 'https://page.example/')!;
    assert.deepEqual(bestInlineDashSource(dash)?.audioUrl, null);
    assert.equal(bestInlineDashSource(dash)?.url, 'https://c.example/muxed.mp4');
  });

  test('protection, live and several periods are recognised; segmented or audio-only names nothing usable', () => {
    assert.equal(parseInlineDash(mpd(set('video/mp4', '<ContentProtection schemeIdUri="urn:uuid:x"/>')), 'https://p.example/')?.protected, true);
    assert.equal(parseInlineDash(mpd('', 'type="dynamic"'), 'https://p.example/')?.live, true);
    const periods = parseInlineDash(`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>${set('video/mp4', rep('codecs="avc1"', 'https://c.example/1.mp4'))}</Period><Period></Period></MPD>`, 'https://p.example/')!;
    assert.equal(bestInlineDashSource(periods), null);
    const segmented = parseInlineDash(mpd(set('video/mp4', '<Representation codecs="avc1"><BaseURL>https://c.example/</BaseURL><SegmentTemplate media="$Number$.m4s"/></Representation>')), 'https://p.example/')!;
    assert.equal(bestInlineDashSource(segmented), null);
    const audioOnly = parseInlineDash(mpd(set('audio/mp4', rep('codecs="mp4a.40.2"', 'https://c.example/a.mp4'))), 'https://p.example/')!;
    assert.equal(bestInlineDashSource(audioOnly), null);
    assert.equal(parseInlineDash('<html>not a manifest</html>', 'https://p.example/'), null);
  });

  test('ISO 8601 durations', () => {
    assert.equal(isoDurationMs('PT1H2M3.5S'), 3_723_500);
    assert.equal(isoDurationMs('P1D'), 86_400_000);
    assert.equal(isoDurationMs('nonsense'), null);
  });
});
