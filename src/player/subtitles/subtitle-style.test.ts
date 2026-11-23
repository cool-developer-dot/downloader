/**
 * P4 Subtitle style: the stored style (#592–#596), right-to-left lines (#600) and where two subtitles go (#599).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lineDirection, planSubtitleBlocks, subtitleLines } from './subtitle-layout.ts';
import {
  EMPTY_SUBTITLE_RECORD,
  addSubtitleFile,
  readSubtitleRecord,
  type SubtitleFileRef,
  type VideoSubtitleRecord,
} from './subtitle-record.ts';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_COLOR_HEX,
  normalizeSubtitleStyle,
  stepSubtitleMargin,
  subtitleEdgeColor,
  subtitleFontFamily,
  subtitleLineHeight,
} from './subtitle-style.ts';

const RLM = String.fromCharCode(0x200f);

describe('subtitle style storage', () => {
  it('starts as white, medium, system font, a dark box, at the bottom', () => {
    assert.deepEqual(normalizeSubtitleStyle(undefined), DEFAULT_SUBTITLE_STYLE);
    assert.deepEqual(DEFAULT_SUBTITLE_STYLE, {
      size: 'medium',
      color: 'white',
      font: 'system',
      edge: 'box',
      anchor: 'bottom',
      marginPercent: 4,
      secondPosition: 'next',
    });
  });

  it('keeps every valid field of a stored style and resets only the damaged ones', () => {
    const stored = { size: 'xlarge', color: 'yellow', font: 'nastaliq', edge: 'outline', anchor: 'top', marginPercent: 13, secondPosition: 'top' };
    assert.deepEqual(normalizeSubtitleStyle(stored), { ...stored, marginPercent: 14 });
    assert.deepEqual(normalizeSubtitleStyle({ ...stored, color: 'purple', marginPercent: 'x', extra: 1 }), {
      ...stored,
      color: 'white',
      marginPercent: 4,
    });
  });

  it('moves the position in 2 % steps between 0 and 40 %', () => {
    assert.equal(stepSubtitleMargin(DEFAULT_SUBTITLE_STYLE, 3).marginPercent, 10);
    assert.equal(stepSubtitleMargin(DEFAULT_SUBTITLE_STYLE, -5).marginPercent, 0);
    assert.equal(stepSubtitleMargin({ ...DEFAULT_SUBTITLE_STYLE, marginPercent: 38 }, 5).marginPercent, 40);
  });

  it("uses the design's swatches, and a light edge for black text", () => {
    assert.equal(SUBTITLE_COLOR_HEX.black, '#000000');
    assert.equal(SUBTITLE_COLOR_HEX.yellow, '#FFD60A');
    assert.equal(SUBTITLE_COLOR_HEX.red, '#D92D20');
    assert.equal(subtitleEdgeColor('white', 0.6), 'rgba(0,0,0,0.6)');
    assert.equal(subtitleEdgeColor('black', 0.6), 'rgba(255,255,255,0.6)');
  });

  it('uses Nastaliq for right-to-left lines only, once loaded; other fonts for every line', () => {
    const families = { inter: 'Inter_400Regular', nastaliq: 'NotoNastaliqUrdu', nastaliqReady: true };
    assert.equal(subtitleFontFamily('nastaliq', 'rtl', families), 'NotoNastaliqUrdu');
    assert.equal(subtitleFontFamily('nastaliq', 'ltr', families), null);
    assert.equal(subtitleFontFamily('nastaliq', 'rtl', { ...families, nastaliqReady: false }), null);
    assert.equal(subtitleFontFamily('inter', 'rtl', families), 'Inter_400Regular');
    assert.equal(subtitleFontFamily('serif', 'ltr', families), 'serif');
    assert.equal(subtitleFontFamily('condensed', 'ltr', families), 'sans-serif-condensed');
    assert.equal(subtitleFontFamily('system', 'ltr', families), null);
    assert.equal(subtitleLineHeight(20, true), 40);
    assert.equal(subtitleLineHeight(20, false), 26);
  });
});

describe('#600 right-to-left lines', () => {
  it('reads real Urdu lines as right to left', () => {
    assert.equal(lineDirection('آپ کیسے ہیں؟'), 'rtl');
    assert.equal(lineDirection('میں ٹھیک ہوں، شکریہ۔'), 'rtl');
    assert.equal(lineDirection('مرحبا بكم'), 'rtl');
  });

  it('keeps an Urdu line with English and numbers right to left, and an English line with an Urdu word left to right', () => {
    assert.equal(lineDirection('WiFi کا پاس ورڈ 1234 ہے'), 'rtl');
    assert.equal(lineDirection('میرا فون نمبر 0300-1234567 ہے اور ای میل test@example.com'), 'rtl');
    assert.equal(lineDirection('ٹرین 7:45 پر Lahore سے چلے گی'), 'rtl');
    assert.equal(lineDirection('Hello دوست'), 'ltr');
    assert.equal(lineDirection('Hello, how are you?'), 'ltr');
    assert.equal(lineDirection('123 456'), 'ltr');
    assert.equal(lineDirection('♪ ♪'), 'ltr');
    assert.equal(lineDirection('ab اب'), 'ltr');
    assert.equal(lineDirection('اب ab'), 'rtl');
  });

  it('marks each right-to-left line so Android lays it out right to left, line by line', () => {
    assert.deepEqual(subtitleLines('Hello\nWiFi کا پاس ورڈ 1234 ہے\n\n'), [
      { text: 'Hello', direction: 'ltr' },
      { text: `${RLM}WiFi کا پاس ورڈ 1234 ہے`, direction: 'rtl' },
    ]);
    assert.deepEqual(subtitleLines(`${RLM}آپ`), [{ text: `${RLM}آپ`, direction: 'rtl' }]);
  });
});

describe('#599 two subtitles together', () => {
  const style = { anchor: 'bottom' as const, marginPercent: 4, secondPosition: 'next' as const };

  it('places one subtitle at the chosen edge and distance', () => {
    assert.deepEqual(planSubtitleBlocks({ primary: true, primaryNative: false, secondary: false, style }), [
      { anchor: 'bottom', marginPercent: 4, tracks: ['primary'] },
    ]);
    assert.deepEqual(planSubtitleBlocks({ primary: false, primaryNative: false, secondary: false, style }), []);
  });

  it('puts the second next to the first, on the side away from the edge', () => {
    assert.deepEqual(planSubtitleBlocks({ primary: true, primaryNative: false, secondary: true, style }), [
      { anchor: 'bottom', marginPercent: 4, tracks: ['secondary', 'primary'] },
    ]);
    assert.deepEqual(
      planSubtitleBlocks({ primary: true, primaryNative: false, secondary: true, style: { ...style, anchor: 'top' } }),
      [{ anchor: 'top', marginPercent: 4, tracks: ['primary', 'secondary'] }],
    );
  });

  it('puts the second at the top when asked, sharing the block if the first is at the top too', () => {
    const top = { ...style, secondPosition: 'top' as const };
    assert.deepEqual(planSubtitleBlocks({ primary: true, primaryNative: false, secondary: true, style: top }), [
      { anchor: 'bottom', marginPercent: 4, tracks: ['primary'] },
      { anchor: 'top', marginPercent: 4, tracks: ['secondary'] },
    ]);
    assert.deepEqual(
      planSubtitleBlocks({ primary: true, primaryNative: false, secondary: true, style: { ...top, anchor: 'top' } }),
      [{ anchor: 'top', marginPercent: 4, tracks: ['primary', 'secondary'] }],
    );
  });

  it('keeps the second clear of a track the player draws itself, and shows it alone when the first is off', () => {
    assert.deepEqual(planSubtitleBlocks({ primary: false, primaryNative: true, secondary: true, style }), [
      { anchor: 'top', marginPercent: 4, tracks: ['secondary'] },
    ]);
    assert.deepEqual(planSubtitleBlocks({ primary: false, primaryNative: false, secondary: true, style }), [
      { anchor: 'bottom', marginPercent: 4, tracks: ['secondary'] },
    ]);
  });

  it('remembers the second track per video, and forgets it with its file', () => {
    const file = (id: string): SubtitleFileRef => ({
      id,
      name: `${id}.srt`,
      uri: `file:///s/${id}.srt`,
      format: 'srt',
      language: 'ur',
      encoding: 'auto',
      origin: 'picked',
    });
    const read = readSubtitleRecord({ primary: { kind: 'off' }, files: [file('a')], offsetMs: 0, secondary: { kind: 'file', fileId: 'a' } });
    assert.deepEqual(read.secondary, { kind: 'file', fileId: 'a' });
    assert.equal(readSubtitleRecord({ files: [], secondary: { kind: 'file', fileId: 'gone' } }).secondary, undefined);
    assert.equal(readSubtitleRecord({ files: [], secondary: { kind: 'embedded', id: '1' } }).secondary, undefined);
    let record: VideoSubtitleRecord = { ...EMPTY_SUBTITLE_RECORD, files: [file('a')], secondary: { kind: 'file', fileId: 'a' } };
    record = addSubtitleFile(record, file('b'), 1).record;
    assert.equal(record.secondary, null);
  });
});
