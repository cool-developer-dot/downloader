/**
 * P3 Subtitles: the parsers (#603), encodings (#601), cue lookup and sync offset (#597), files next to the video
 * (#590), and what is remembered per video.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activeCuesAt,
  createCueIndex,
  formatSubtitleOffset,
  normalizeSubtitleOffset,
  stepSubtitleOffset,
  subtitleTimeMs,
  type SubtitleCue,
} from './cues.ts';
import { detectSubtitleFormat, parseAss, parseSrt, parseSubtitles, parseVtt } from './parse-subtitles.ts';
import { baseLanguage, matchSidecarSubtitles, preferredSidecar } from './sidecar.ts';
import { decodeSubtitleBytes, detectEncoding, encodeLegacy, isValidUtf8 } from './subtitle-encoding.ts';
import {
  EMPTY_SUBTITLE_RECORD,
  addSubtitleFile,
  pickedCopies,
  readSubtitleRecord,
  readSubtitleRecords,
  rememberSubtitleRecord,
  subtitleRecordFor,
  type SubtitleFileRef,
  type VideoSubtitleRecord,
} from './subtitle-record.ts';

const URDU = 'یہ ایک سب ٹائٹل ہے';
const cue = (startMs: number, endMs: number, text: string): SubtitleCue => ({ startMs, endMs, text });
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

describe('#603 SRT', () => {
  it('reads numbered blocks, keeps line breaks and removes tags', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,500',
      '<i>Hello</i> <font color="#ff0000">there</font>',
      'second line',
      '',
      '2',
      '00:01:02,050 --> 00:01:03,000',
      '{\\an8}On top',
      '',
    ].join('\r\n');
    assert.deepEqual(parseSrt(srt), [cue(1000, 2500, 'Hello there\nsecond line'), cue(62050, 63000, 'On top')]);
  });

  it('copes with a byte-order mark, a missing index, "." for ",", short fractions and a missing blank line', () => {
    const srt = `${String.fromCharCode(0xfeff)}00:00:01.5 --> 00:00:02.25\nA\n2\n00:00:03,000 --> 00:00:04,000\nB`;
    assert.deepEqual(parseSrt(srt), [cue(1500, 2250, 'A'), cue(3000, 4000, 'B')]);
  });

  it('leaves out cues with no text or that end before they start', () => {
    const srt = '1\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n2\n00:00:06,000 --> 00:00:07,000\n<i></i>\n\n3\n00:00:08,000 --> 00:00:09,000\nKept\n';
    assert.deepEqual(parseSrt(srt), [cue(8000, 9000, 'Kept')]);
  });

  it('keeps Urdu text as it is', () => {
    assert.deepEqual(parseSrt(`1\n00:00:01,000 --> 00:00:02,000\n${URDU}\n`), [cue(1000, 2000, URDU)]);
  });
});

describe('#603 WebVTT', () => {
  it('skips the header, NOTE and STYLE blocks, cue ids and settings; removes tags; decodes entities', () => {
    const vtt = [
      'WEBVTT - with a title',
      'X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000',
      '',
      'NOTE a comment',
      'over two lines',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'intro',
      '00:01.000 --> 00:02.000 align:start position:10%',
      '<v Roger>Hi &amp; <c.loud>welcome</c></v>',
      '',
      '01:00:00.000 --> 01:00:01.500',
      'Tom &lt;3 <00:00:00.500>karaoke &nbsp;end',
      '',
    ].join('\n');
    assert.deepEqual(parseVtt(vtt), [
      cue(1000, 2000, 'Hi & welcome'),
      cue(3_600_000, 3_601_500, `Tom <3 karaoke ${String.fromCharCode(0xa0)}end`),
    ]);
  });

  it('reads a cue that follows the header without a blank line, and ruby text without its reading', () => {
    const vtt = 'WEBVTT\n00:00:01.000 --> 00:00:02.000\n<ruby>漢<rt>kan</rt></ruby>字\n';
    assert.deepEqual(parseVtt(vtt), [cue(1000, 2000, '漢字')]);
  });
});

describe('#603 ASS / SSA', () => {
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour',
    'Style: Default,Arial,20,&H00FFFFFF',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\an8\\c&H00FF00&}Top, with commas, kept\\Nnext line',
    'Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,not shown',
    'Dialogue: 1,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\pos(10,20)\\fad(200,200)}Hard\\hspace {\\k20}ka{\\k30}ra',
    'Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}Sign',
  ].join('\n');

  it('keeps the text: override blocks out, \\N a new line, \\h a no-break space, drawings and comments left out', () => {
    const { cues } = parseAss(ass);
    assert.deepEqual(cues, [
      cue(1000, 2500, 'Top, with commas, kept\nnext line'),
      cue(5000, 6000, `Hard${String.fromCharCode(0xa0)}space kara`),
      cue(7000, 8000, 'Sign'),
    ]);
  });

  it('reports the features it does not draw', () => {
    assert.deepEqual(parseAss(ass).unsupported, [
      'position',
      'alignment',
      'fade',
      'karaoke',
      'drawing',
      'colour',
      'styles',
      'layers',
    ]);
  });

  it('reads SSA v4 (Marked instead of Layer) and a missing Format line', () => {
    const ssa = '[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0000,0000,0000,,Old style';
    assert.deepEqual(parseAss(ssa).cues, [cue(1000, 2000, 'Old style')]);
    assert.deepEqual(parseAss('[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,No format').cues, [
      cue(1000, 2000, 'No format'),
    ]);
  });
});

describe('#603 format detection', () => {
  it('goes by the extension, then by the first lines', () => {
    assert.equal(detectSubtitleFormat('movie.en.SRT', ''), 'srt');
    assert.equal(detectSubtitleFormat('movie.ssa', ''), 'ass');
    assert.equal(detectSubtitleFormat('download', 'WEBVTT\n\n00:01.000 --> 00:02.000\nx'), 'vtt');
    assert.equal(detectSubtitleFormat(null, '[Script Info]\nTitle: x'), 'ass');
    assert.equal(detectSubtitleFormat('subs.txt', '1\n00:00:01,000 --> 00:00:02,000\nx'), 'srt');
    assert.equal(detectSubtitleFormat('notes.txt', 'just text'), null);
    assert.equal(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nx', 'vtt').cues.length, 1);
  });
});

describe('#601 encodings', () => {
  it('detects UTF-8 with and without a byte-order mark, and drops the mark', () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(URDU)]);
    assert.deepEqual(detectEncoding(bom), { encoding: 'utf-8', bom: true });
    assert.deepEqual(decodeSubtitleBytes(bom), { text: URDU, encoding: 'utf-8' });
    assert.deepEqual(detectEncoding(utf8(`1\n00:00:01,000 --> 00:00:02,000\n${URDU}`)), { encoding: 'utf-8', bom: false });
  });

  it('detects UTF-16 LE and BE, with a byte-order mark or from the zero bytes', () => {
    const le = new Uint8Array(Buffer.from(`${String.fromCharCode(0xfeff)}00:00:01,000 ${URDU}`, 'utf16le'));
    assert.equal(detectEncoding(le).encoding, 'utf-16le');
    assert.equal(decodeSubtitleBytes(le).text, `00:00:01,000 ${URDU}`);
    const be = Uint8Array.from(le, (_, i) => le[i % 2 === 0 ? i + 1 : i - 1]!);
    assert.deepEqual(detectEncoding(be), { encoding: 'utf-16be', bom: true });
    assert.equal(decodeSubtitleBytes(be).text, `00:00:01,000 ${URDU}`);
    const noBom = new Uint8Array(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello there\n', 'utf16le'));
    assert.deepEqual(detectEncoding(noBom), { encoding: 'utf-16le', bom: false });
    assert.equal(decodeSubtitleBytes(noBom).text, '1\n00:00:01,000 --> 00:00:02,000\nHello there\n');
  });

  it('reads old Windows files: Arabic-script text as Windows-1256, Western text as Windows-1252', () => {
    const urduLine = 'پاکستان زندہ باد';
    const urduBytes = encodeLegacy(`1\n00:00:01,000 --> 00:00:02,000\n${urduLine}\n`, 'windows-1256');
    assert.equal(isValidUtf8(urduBytes), false);
    assert.deepEqual(detectEncoding(urduBytes), { encoding: 'windows-1256', bom: false });
    assert.ok(decodeSubtitleBytes(urduBytes).text.includes(urduLine));
    const western = encodeLegacy('1\n00:00:01,000 --> 00:00:02,000\nCafé crème — €5\n', 'windows-1252');
    assert.deepEqual(detectEncoding(western), { encoding: 'windows-1252', bom: false });
    assert.ok(decodeSubtitleBytes(western).text.includes('Café crème — €5'));
  });

  it('decodes in the encoding chosen by hand, whatever the bytes look like', () => {
    const bytes = Uint8Array.from([0x81, 0x80, 0x8d]);
    assert.equal(decodeSubtitleBytes(bytes, 'windows-1256').text, 'پ€چ');
    assert.equal(decodeSubtitleBytes(bytes, 'windows-1252').text, `${String.fromCharCode(0x81)}€${String.fromCharCode(0x8d)}`);
    assert.equal(decodeSubtitleBytes(Uint8Array.from([0xff, 0x41]), 'utf-8').text, `${String.fromCharCode(0xfffd)}A`);
  });

  it('refuses overlong and surrogate UTF-8 as UTF-8', () => {
    assert.equal(isValidUtf8(Uint8Array.from([0xc0, 0xaf])), false);
    assert.equal(isValidUtf8(Uint8Array.from([0xed, 0xa0, 0x80])), false);
    assert.equal(isValidUtf8(Uint8Array.from([0xe2, 0x82])), false);
    assert.equal(isValidUtf8(utf8('€ ok')), true);
  });
});

describe('cue lookup by time', () => {
  const index = createCueIndex([cue(5000, 6000, 'C'), cue(1000, 9000, 'Long'), cue(1000, 2000, 'A'), cue(3000, 4000, 'B')]);

  it('finds every cue showing, in start order; the end is exclusive', () => {
    assert.deepEqual(activeCuesAt(index, 1500).map((c) => c.text), ['Long', 'A']);
    assert.deepEqual(activeCuesAt(index, 2000).map((c) => c.text), ['Long']);
    assert.deepEqual(activeCuesAt(index, 5500).map((c) => c.text), ['Long', 'C']);
    assert.deepEqual(activeCuesAt(index, 999), []);
    assert.deepEqual(activeCuesAt(index, 9000), []);
    assert.deepEqual(activeCuesAt(createCueIndex([]), 10), []);
    assert.deepEqual(activeCuesAt(index, Number.NaN), []);
  });

  it('stops looking back once no earlier cue can still show (a long file stays fast)', () => {
    const many = createCueIndex(Array.from({ length: 10_000 }, (_, i) => cue(i * 1000, i * 1000 + 900, `#${i}`)));
    assert.deepEqual(activeCuesAt(many, 4_567_100).map((c) => c.text), ['#4567']);
    assert.deepEqual(activeCuesAt(many, 4_567_950), []);
  });
});

describe('#597 sync offset', () => {
  it('moves in 100 ms steps, stays within ±5 minutes, and resets to 0', () => {
    assert.equal(stepSubtitleOffset(0, 1), 100);
    assert.equal(stepSubtitleOffset(0, -3), -300);
    assert.equal(stepSubtitleOffset(450, 1), 600);
    assert.equal(stepSubtitleOffset(299_950, 10), 300_000);
    assert.equal(normalizeSubtitleOffset(-1_000_000), -300_000);
    assert.equal(normalizeSubtitleOffset('5'), 0);
    assert.equal(normalizeSubtitleOffset(-0.4), 0);
  });

  it('shows subtitles later with a positive offset, earlier with a negative one', () => {
    assert.equal(subtitleTimeMs(10, 500), 9500);
    assert.equal(subtitleTimeMs(10, -500), 10_500);
    const index = createCueIndex([cue(10_000, 11_000, 'x')]);
    assert.equal(activeCuesAt(index, subtitleTimeMs(10.2, 500)).length, 0);
    assert.equal(activeCuesAt(index, subtitleTimeMs(10.6, 500)).length, 1);
  });

  it('formats the offset with a sign', () => {
    assert.equal(formatSubtitleOffset(500), '+0.5 s');
    assert.equal(formatSubtitleOffset(-1200), `${String.fromCharCode(0x2212)}1.2 s`);
    assert.equal(formatSubtitleOffset(0), '0.0 s');
  });
});

describe('#590 files next to the video', () => {
  const names = [
    'Episode 1.mp4',
    'Episode 1.ur.vtt',
    'episode 1.SRT',
    'Episode 1.en-US.2.vtt',
    'Episode 1.und.vtt',
    'Episode 10.srt',
    'Episode 1.ass',
    'Episode 1.nfo',
    'Other.srt',
  ];

  it('finds subtitles named like the video, with their language, the plainest names first', () => {
    assert.deepEqual(matchSidecarSubtitles('Episode 1.mp4', names), [
      { name: 'Episode 1.ass', format: 'ass', language: null },
      { name: 'episode 1.SRT', format: 'srt', language: null },
      { name: 'Episode 1.en-US.2.vtt', format: 'vtt', language: 'en-US' },
      { name: 'Episode 1.und.vtt', format: 'vtt', language: null },
      { name: 'Episode 1.ur.vtt', format: 'vtt', language: 'ur' },
    ]);
    assert.deepEqual(matchSidecarSubtitles('', names), []);
  });

  it('prefers the app language, then English, then a file without a language', () => {
    const found = matchSidecarSubtitles('Episode 1.mp4', names);
    assert.equal(preferredSidecar(found, 'ur')?.name, 'Episode 1.ur.vtt');
    assert.equal(preferredSidecar(found, 'fr')?.name, 'Episode 1.en-US.2.vtt');
    assert.equal(preferredSidecar(found.filter((f) => f.language !== 'en-US'), 'fr')?.name, 'Episode 1.ass');
    assert.equal(preferredSidecar([], 'en'), null);
    assert.equal(baseLanguage('eng'), 'en');
    assert.equal(baseLanguage('pt_BR'), 'pt');
    assert.equal(baseLanguage(null), null);
  });
});

describe('remembered per video', () => {
  const file = (id: string, origin: SubtitleFileRef['origin'] = 'picked'): SubtitleFileRef => ({
    id,
    name: `${id}.srt`,
    uri: `file:///data/subtitles/${id}.srt`,
    format: 'srt',
    language: null,
    encoding: 'auto',
    origin,
  });
  const record = (overrides: Partial<VideoSubtitleRecord> = {}): VideoSubtitleRecord => ({
    ...EMPTY_SUBTITLE_RECORD,
    ...overrides,
  });

  it('keeps the chosen track, the files and the offset; forgets an empty record', () => {
    const chosen = record({ primary: { kind: 'file', fileId: 'a' }, files: [file('a')], offsetMs: 500 });
    let { list } = rememberSubtitleRecord([], 'v1', chosen);
    ({ list } = rememberSubtitleRecord(list, 'v2', record({ primary: { kind: 'off' } })));
    assert.deepEqual(subtitleRecordFor(list, 'v1'), chosen);
    assert.deepEqual(subtitleRecordFor(list, 'v2').primary, { kind: 'off' });
    assert.deepEqual(subtitleRecordFor(list, 'v3'), EMPTY_SUBTITLE_RECORD);
    ({ list } = rememberSubtitleRecord(list, 'v2', EMPTY_SUBTITLE_RECORD));
    assert.deepEqual(list.map(([id]) => id), ['v1']);
  });

  it('forgets the least recently changed video past the limit, handing back its record for clean-up', () => {
    let list = rememberSubtitleRecord([], 'a', record({ offsetMs: 100 })).list;
    list = rememberSubtitleRecord(list, 'b', record({ offsetMs: 200 }), 2).list;
    const result = rememberSubtitleRecord(list, 'c', record({ files: [file('x')] }), 2);
    assert.deepEqual(result.list.map(([id]) => id), ['b', 'c']);
    assert.deepEqual(result.evicted.map((r) => r.offsetMs), [100]);
  });

  it('reads stored data defensively and ignores fields it does not know (a later package may add some)', () => {
    const raw = [
      ['v1', { primary: { kind: 'embedded', id: '3', language: 'en', label: 'English' }, files: [], offsetMs: 349, laterField: { anything: 1 } }],
      ['v2', { primary: { kind: 'file', fileId: 'gone' }, files: [{ id: 'x' }], offsetMs: 'no' }],
      ['v3', 'junk'],
      ['v4', { primary: { kind: 'file', fileId: 'a' }, files: [file('a'), file('a')], offsetMs: 0, encoding: 'x' }],
      [7, {}],
    ];
    const list = readSubtitleRecords(raw);
    assert.deepEqual(list.map(([id]) => id), ['v1', 'v4']);
    assert.deepEqual(subtitleRecordFor(list, 'v1'), {
      primary: { kind: 'embedded', id: '3', language: 'en', label: 'English' },
      files: [],
      offsetMs: 300,
    });
    assert.equal(subtitleRecordFor(list, 'v4').files.length, 1);
    assert.deepEqual(readSubtitleRecord({ primary: { kind: 'file', fileId: 'gone' } }).primary, null);
    assert.deepEqual(readSubtitleRecords('nope'), []);
  });

  it('keeps at most a few files per video, dropping the oldest loaded one (and the choice, if it was that one)', () => {
    let current = record({ primary: { kind: 'file', fileId: 'a' } });
    current = addSubtitleFile(current, file('a'), 2).record;
    current = addSubtitleFile(current, file('b'), 2).record;
    const result = addSubtitleFile(current, file('c'), 2);
    assert.deepEqual(result.record.files.map((f) => f.id), ['b', 'c']);
    assert.deepEqual(result.dropped.map((f) => f.id), ['a']);
    assert.equal(result.record.primary, null);
    assert.deepEqual(pickedCopies(record({ files: [file('p'), file('d', 'detected')] })).map((f) => f.id), ['p']);
  });
});
