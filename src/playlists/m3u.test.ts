/**
 * P7 #629 — reading M3U / M3U8 (line endings, BOM, comments, #EXTINF, file:// URIs, Windows / POSIX paths, Urdu
 * names, web links skipped and counted) and writing M3U8 (and reading the export back).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isRemoteLocation,
  locationFileName,
  locationSegments,
  parseExtinf,
  parseM3u,
  writeM3u8,
} from './m3u.ts';

// Built from char codes, so no escape in this file can be rewritten on the way to disk.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;
const BOM = String.fromCharCode(0xfeff);

const URDU_FILE = 'میرا پسندیدہ گانا.mp4';

describe('P7 M3U reading', () => {
  it('reads #EXTINF titles and durations; LF, CRLF, CR and mixed endings are the same file', () => {
    const lines = ['#EXTM3U', '#EXTINF:123,First clip', 'first.mp4', '', '#EXTINF:-1,Second', 'second.mkv', 'third.webm'];
    const expected = [
      { location: 'first.mp4', title: 'First clip', durationSeconds: 123 },
      { location: 'second.mkv', title: 'Second', durationSeconds: null },
      { location: 'third.webm', title: null, durationSeconds: null },
    ];
    for (const join of [LF, CRLF, CR]) {
      const parsed = parseM3u(lines.join(join));
      assert.deepEqual(parsed.entries, expected, JSON.stringify(join));
      assert.equal(parsed.extended, true);
      assert.equal(parsed.skippedRemote, 0);
    }
    const mixed = `#EXTM3U${CRLF}#EXTINF:123,First clip${LF}first.mp4${CR}${CR}#EXTINF:-1,Second${CRLF}second.mkv${LF}third.webm${CRLF}`;
    assert.deepEqual(parseM3u(mixed).entries, expected);
  });

  it('drops a byte-order mark, blank lines and comments; a plain list (no #EXTM3U) is read too', () => {
    const text = `${BOM}#EXTM3U${LF}${LF}   ${LF}# my list${LF}#EXTGRP:Holiday${LF}#EXTVLCOPT:start-time=5${LF}clip.mp4${LF}`;
    const parsed = parseM3u(text);
    assert.equal(parsed.extended, true);
    assert.deepEqual(parsed.entries, [{ location: 'clip.mp4', title: null, durationSeconds: null }]);
    const plain = parseM3u(`a.mp4${CRLF}b.mp4`);
    assert.equal(plain.extended, false);
    assert.deepEqual(plain.entries.map((e) => e.location), ['a.mp4', 'b.mp4']);
  });

  it('takes the title after the first comma outside quotes: commas in the title and in attributes survive', () => {
    assert.deepEqual(parseExtinf('#EXTINF:215,Artist, Song (Live, 2019)'), {
      title: 'Artist, Song (Live, 2019)',
      durationSeconds: 215,
    });
    assert.deepEqual(parseExtinf('#EXTINF:-1 tvg-name="News, Sport" group-title="TV",Channel, HD'), {
      title: 'Channel, HD',
      durationSeconds: null,
    });
    assert.deepEqual(parseExtinf('#extinf:12.5,'), { title: null, durationSeconds: 12.5 });
    assert.deepEqual(parseExtinf('#EXTINF:abc'), { title: null, durationSeconds: null });
  });

  it('skips http / https (and other network) lines, counts them, and drops their #EXTINF', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:10,Web one',
      'https://cdn.example/a.mp4',
      'http://example.com/b.m3u8',
      'rtsp://camera.local/stream',
      '#EXTINF:20,Local',
      'local.mp4',
      'HTTPS://EXAMPLE.COM/C.MP4',
    ].join(LF);
    const parsed = parseM3u(text);
    assert.equal(parsed.skippedRemote, 4);
    assert.deepEqual(parsed.entries, [{ location: 'local.mp4', title: 'Local', durationSeconds: 20 }]);
    assert.equal(isRemoteLocation('file:///sdcard/x.mp4'), false);
    assert.equal(isRemoteLocation('content://media/external/video/media/5'), false);
    assert.equal(isRemoteLocation('C:\\Videos\\x.mp4'), false);
  });

  it('Urdu file names and titles, as written', () => {
    const text = ['#EXTM3U', `#EXTINF:95,پاکستان کا سفر، حصہ اول`, `ویڈیوز/${URDU_FILE}`].join(CRLF);
    const [entry] = parseM3u(text).entries;
    assert.equal(entry?.title, 'پاکستان کا سفر، حصہ اول');
    assert.equal(entry?.location, `ویڈیوز/${URDU_FILE}`);
    assert.equal(locationFileName(entry!.location), URDU_FILE);
  });

  it('paths: file:// URIs decoded; Windows and POSIX paths split as written (never decoded)', () => {
    assert.deepEqual(locationSegments('file:///storage/emulated/0/Movies/My%20Clip%20%231.mp4'), [
      'storage',
      'emulated',
      '0',
      'Movies',
      'My Clip #1.mp4',
    ]);
    const encodedUrdu = `file:///sdcard/${encodeURIComponent(URDU_FILE)}`;
    assert.equal(locationFileName(encodedUrdu), URDU_FILE);
    assert.deepEqual(locationSegments('file://localhost/C:/Videos/a.mp4'), ['Videos', 'a.mp4']);
    assert.deepEqual(locationSegments('C:\\Users\\Ali\\Videos\\100%25 real.mp4'), ['Users', 'Ali', 'Videos', '100%25 real.mp4']);
    assert.deepEqual(locationSegments('/storage/emulated/0/Download/x.mp4'), ['storage', 'emulated', '0', 'Download', 'x.mp4']);
    assert.deepEqual(locationSegments('../Videos/./x.mp4'), ['Videos', 'x.mp4']);
    assert.deepEqual(locationSegments('content://com.android.externalstorage.documents/tree/primary%3AMovies/document/primary%3AMovies%2FVidoraX%2Fa.mp4'), [
      'Movies',
      'VidoraX',
      'a.mp4',
    ]);
    // A stray % in a file:// URI: kept as written rather than failing.
    assert.equal(locationFileName('file:///sdcard/50%off.mp4'), '50%off.mp4');
    assert.equal(locationSegments('https://x.test/a.mp4'), null);
  });
});

describe('P7 M3U8 writing (export)', () => {
  it('writes #EXTM3U, #EXTINF with whole seconds or -1, and the file name as the path line', () => {
    const text = writeM3u8([
      { title: 'Cooking, part 1', fileName: 'cooking-1.mp4', durationSeconds: 61.6 },
      { title: 'پاکستان کا سفر', fileName: URDU_FILE, durationSeconds: null },
      { title: '', fileName: 'untitled.webm', durationSeconds: 0 },
    ]);
    assert.equal(
      text,
      [
        '#EXTM3U',
        '#EXTINF:62,Cooking, part 1',
        'cooking-1.mp4',
        '#EXTINF:-1,پاکستان کا سفر',
        URDU_FILE,
        '#EXTINF:-1,untitled',
        'untitled.webm',
        '',
      ].join(LF),
    );
    assert.ok(!text.includes(CR));
  });

  it('keeps every entry on its lines: line breaks in names become spaces, a name starting with # gets ./', () => {
    const text = writeM3u8([
      { title: `Two${CRLF}lines`, fileName: `odd${LF}name.mp4`, durationSeconds: 5 },
      { title: 'Hash', fileName: '#1 hit.mp4', durationSeconds: 5 },
      { title: '', fileName: '', durationSeconds: 5 },
    ]);
    assert.deepEqual(text.split(LF), ['#EXTM3U', '#EXTINF:5,Two lines', 'odd name.mp4', '#EXTINF:5,Hash', './#1 hit.mp4', '']);
  });

  it('reads its own export back: same names, titles (commas kept) and durations', () => {
    const lines = [
      { title: 'A, B and C', fileName: 'abc.mp4', durationSeconds: 30 },
      { title: 'اردو، عنوان', fileName: URDU_FILE, durationSeconds: 125 },
      { title: 'Hash', fileName: '#1 hit.mp4', durationSeconds: null },
    ];
    const parsed = parseM3u(writeM3u8(lines));
    assert.equal(parsed.extended, true);
    assert.deepEqual(
      parsed.entries.map((e) => [locationFileName(e.location), e.title, e.durationSeconds]),
      [
        ['abc.mp4', 'A, B and C', 30],
        [URDU_FILE, 'اردو، عنوان', 125],
        ['#1 hit.mp4', 'Hash', null],
      ],
    );
  });
});
