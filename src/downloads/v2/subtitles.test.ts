import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { DownloadSubtitles, SubtitleTrackInfo } from '@modules/vidorax-media/src/subtitles.types';

import type { V2EnginePort } from './engine-port';
import {
  attachSubtitleChoice,
  forgetSubtitleRecords,
  refreshSubtitleRecord,
  useSubtitleRecordsStore,
  useSubtitleSettingsStore,
} from './subtitle-store';
import {
  DEFAULT_SUBTITLE_MODE,
  normalizeSubtitleMode,
  plainCueText,
  primaryLanguage,
  selectSubtitleTracks,
  subtitleExportFileName,
  vttToSrt,
} from './subtitles';

function track(id: string, overrides: Partial<SubtitleTrackInfo> = {}): SubtitleTrackInfo {
  return { id, language: null, name: null, format: 'webvtt', isDefault: false, isForced: false, refused: null, ...overrides };
}

const TRACKS = [
  track('en', { language: 'en-US', name: 'English' }),
  track('ur-forced', { language: 'ur', isForced: true }),
  track('ur', { language: 'ur', name: 'اردو' }),
  track('fr-ttml', { language: 'fr', format: 'ttml' }),
  track('de-embedded', { language: 'de', refused: 'embedded', format: null }),
  track('es-protected', { language: 'es', refused: 'encrypted' }),
];

describe('H19 subtitles: which tracks', () => {
  test('off by default; the default choice is the app language', () => {
    assert.equal(useSubtitleSettingsStore.getState().enabled, false);
    assert.equal(DEFAULT_SUBTITLE_MODE, 'app_language');
    assert.equal(normalizeSubtitleMode('first'), 'first');
    assert.equal(normalizeSubtitleMode('nope'), 'app_language');
  });

  test('All takes every usable track, TTML included; refused ones never', () => {
    assert.deepEqual(selectSubtitleTracks(TRACKS, 'all', 'en'), ['en', 'ur-forced', 'ur', 'fr-ttml']);
  });

  test('App language takes its language (full subtitles before forced ones), else the first track', () => {
    assert.deepEqual(selectSubtitleTracks(TRACKS, 'app_language', 'ur'), ['ur']);
    assert.deepEqual(selectSubtitleTracks(TRACKS, 'app_language', 'en'), ['en']);
    assert.deepEqual(selectSubtitleTracks(TRACKS, 'app_language', 'ja'), ['en']);
    assert.deepEqual(selectSubtitleTracks([track('f', { language: 'ur', isForced: true })], 'app_language', 'ur'), ['f']);
    assert.equal(primaryLanguage('EN_gb'), 'en');
    assert.equal(primaryLanguage(null), null);
  });

  test('First track only, and nothing when nothing is usable', () => {
    assert.deepEqual(selectSubtitleTracks(TRACKS, 'first', 'ur'), ['en']);
    assert.deepEqual(selectSubtitleTracks([TRACKS[4]!, TRACKS[5]!], 'all', 'en'), []);
    assert.deepEqual(selectSubtitleTracks([], 'first', 'en'), []);
  });
});

describe('H19 subtitles: names', () => {
  test('"<title>.<lang>.<ext>" without path characters; unknown language is "und"', () => {
    assert.equal(subtitleExportFileName('My: clip/1', 'en-US', 'srt'), 'My clip 1.en-US.srt');
    assert.equal(subtitleExportFileName('   ', null, 'vtt'), 'Video.und.vtt');
    assert.equal(subtitleExportFileName('ویڈیو', 'ur', 'vtt'), 'ویڈیو.ur.vtt');
    assert.equal(subtitleExportFileName('x'.repeat(300), 'en', 'vtt').length, 120 + '.en.vtt'.length);
  });
});

describe('H19 subtitles: VTT to SRT', () => {
  const VTT = [
    'WEBVTT',
    'Kind: captions',
    '',
    'NOTE a comment',
    'that spans lines',
    '',
    'STYLE',
    '::cue { color: red }',
    '',
    'intro',
    '00:01.000 --> 00:02.500 align:start position:10%',
    '<v Roger>Hello &amp; <b>welcome</b></v>',
    '<i>second line</i>',
    '',
    '01:02:03.004 --> 01:02:04.000',
    '<c.yellow>Tom &lt;3 Jerry</c>&nbsp;!',
    '',
    '00:05.000 --> 00:06.000',
    '<00:05.500>',
    '',
  ].join('\r\n');

  test('numbered cues, comma milliseconds, settings dropped, multi-line kept, tags and entities cleaned', () => {
    assert.equal(
      vttToSrt(VTT),
      [
        '1',
        '00:00:01,000 --> 00:00:02,500',
        'Hello & welcome',
        'second line',
        '',
        '2',
        '01:02:03,004 --> 01:02:04,000',
        'Tom <3 Jerry !',
        '',
      ].join('\n'),
    );
  });

  test('nothing to convert gives an empty file', () => {
    assert.equal(vttToSrt('WEBVTT\n\nNOTE only a note\n'), '');
    assert.equal(plainCueText('<ruby>漢<rt>kan</rt></ruby>'), '漢kan');
  });
});

describe('H19 subtitles: the choice reaches native', () => {
  const calls: string[] = [];
  function engine(tracks: SubtitleTrackInfo[] | Error): V2EnginePort {
    return {
      probeSubtitles: async () => {
        calls.push('probe');
        if (tracks instanceof Error) {
          throw tracks;
        }
        return tracks;
      },
      setDownloadSubtitles: async (id: string, ids: string[]) => void calls.push(`set:${id}:${ids.join(',')}`),
    } as unknown as V2EnginePort;
  }
  const request = { url: 'https://cdn.example/master.m3u8', kind: 'hls' as const, request: { headers: {} } as never };

  beforeEach(() => {
    calls.length = 0;
  });

  test('setting off: nothing is asked (today’s behaviour)', async () => {
    assert.deepEqual(await attachSubtitleChoice(engine(TRACKS), 'd1', request, { enabled: false, mode: 'all' }, 'en'), []);
    assert.deepEqual(calls, []);
  });

  test('a file download, or a build without subtitles, asks nothing', async () => {
    assert.deepEqual(
      await attachSubtitleChoice(engine(TRACKS), 'd1', { ...request, kind: 'progressive' }, { enabled: true, mode: 'all' }, 'en'),
      [],
    );
    assert.deepEqual(await attachSubtitleChoice({} as V2EnginePort, 'd1', request, { enabled: true, mode: 'all' }, 'en'), []);
    assert.deepEqual(calls, []);
  });

  test('on: the chosen tracks are handed over for that download', async () => {
    const ids = await attachSubtitleChoice(engine(TRACKS), 'd1', request, { enabled: true, mode: 'app_language' }, 'ur');
    assert.deepEqual(ids, ['ur']);
    assert.deepEqual(calls, ['probe', 'set:d1:ur']);
  });

  test('no usable track, or a failed read, never affects the download', async () => {
    assert.deepEqual(await attachSubtitleChoice(engine([TRACKS[4]!]), 'd1', request, { enabled: true, mode: 'all' }, 'en'), []);
    assert.deepEqual(await attachSubtitleChoice(engine(new Error('offline')), 'd1', request, { enabled: true, mode: 'all' }, 'en'), []);
    assert.deepEqual(calls, ['probe', 'probe']);
  });
});

describe('H19 subtitles: the Download Details cache', () => {
  beforeEach(() => useSubtitleRecordsStore.setState({ byId: {} }));

  test('a record is read from native and forgotten when its video is deleted', async () => {
    const record: DownloadSubtitles = {
      state: 'done',
      subtitles: [{ index: 0, language: 'en', name: null, bytes: 120 }],
      failed: 0,
      note: null,
    };
    const engine = { getDownloadSubtitles: async () => record } as unknown as V2EnginePort;
    assert.deepEqual(await refreshSubtitleRecord('v1', engine), record);
    assert.deepEqual(await refreshSubtitleRecord('v2', engine), record);
    forgetSubtitleRecords(['v1', 'unknown']);
    assert.deepEqual(Object.keys(useSubtitleRecordsStore.getState().byId), ['v2']);
  });

  test('a build without subtitles reads nothing', async () => {
    assert.equal(await refreshSubtitleRecord('v1', {} as V2EnginePort), null);
    assert.deepEqual(useSubtitleRecordsStore.getState().byId, {});
  });
});
