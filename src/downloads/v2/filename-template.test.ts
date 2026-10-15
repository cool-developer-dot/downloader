import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyFilenameTemplate,
  DEFAULT_FILENAME_TEMPLATE,
  FALLBACK_NAME,
  formatTemplateDate,
  formatTemplateTime,
  isDefaultFilenameTemplate,
  MAX_NAME_LENGTH,
  MAX_TEMPLATE_LENGTH,
  normalizeFilenameTemplate,
  renderFilenameTemplate,
  sanitizeFileName,
  templateSiteLabel,
} from './filename-template';

const NOW = new Date(2026, 9, 15, 9, 5, 30); // 2026-10-15 09:05 local

function apply(template: string | null | undefined, title: string, extra: Partial<Parameters<typeof applyFilenameTemplate>[0]> = {}) {
  return applyFilenameTemplate({
    template,
    title,
    pageUrl: 'https://www.example.com/watch/1',
    site: 'web',
    qualityLabel: '720p',
    now: NOW,
    ...extra,
  });
}

describe('default template', () => {
  test('returns the title exactly, even with characters a template would clean', () => {
    for (const title of ['Beach clip', '  spaced  title ', 'a/b: c?', 'ویڈیو کلپ', 'x'.repeat(500), '']) {
      assert.equal(apply(DEFAULT_FILENAME_TEMPLATE, title), title);
      assert.equal(apply(undefined, title), title);
      assert.equal(apply(null, title), title);
      assert.equal(apply('   ', title), title);
      assert.equal(apply('  {title}  ', title), title);
    }
  });

  test('is recognised in any spacing', () => {
    assert.equal(isDefaultFilenameTemplate('{title}'), true);
    assert.equal(isDefaultFilenameTemplate(' {title} '), true);
    assert.equal(isDefaultFilenameTemplate(''), true);
    assert.equal(isDefaultFilenameTemplate(42), true);
    assert.equal(isDefaultFilenameTemplate('{site} {title}'), false);
  });
});

describe('tokens', () => {
  test('every token is filled', () => {
    assert.equal(
      apply('{site} - {title} - {quality} - {date} {time}', 'Beach clip'),
      'example.com - Beach clip - 720p - 2026-10-15 09-05',
    );
  });

  test('token names ignore case; unknown tokens stay as typed', () => {
    assert.equal(apply('{TITLE} {Quality} {nope}', 'Clip'), 'Clip 720p {nope}');
  });

  test('an empty token leaves no dangling separator', () => {
    assert.equal(apply('{title} - {quality}', 'Clip', { qualityLabel: null }), 'Clip');
    assert.equal(apply('{quality} - {title}', 'Clip', { qualityLabel: '' }), 'Clip');
    assert.equal(apply('{title} - {quality} - {date}', 'Clip', { qualityLabel: null }), 'Clip - 2026-10-15');
    assert.equal(apply('{title}_{id}', 'Clip'), 'Clip');
  });

  test('{id} is filled when known', () => {
    assert.equal(apply('{title} {id}', 'Clip', { id: 'ab12' }), 'Clip ab12');
  });

  test('a template that produces nothing falls back to the title, then to "Video"', () => {
    assert.equal(apply('{quality}', 'Clip', { qualityLabel: null }), 'Clip');
    assert.equal(apply('{quality}', '///', { qualityLabel: null }), FALLBACK_NAME);
  });
});

describe('sanitizing', () => {
  test('illegal characters become spaces and whitespace collapses', () => {
    assert.equal(apply('{title}!', 'a/b\\c:d*e?f"g<h>i|j\tk\nl'), 'a b c d e f g h i j k l!');
  });

  test('Urdu, Arabic, CJK and emoji are kept intact', () => {
    assert.equal(apply('{title} - {quality}', 'میری ویڈیو'), 'میری ویڈیو - 720p');
    assert.equal(apply('{title}!', '動画 🎬'), '動画 🎬!');
  });

  test('the name is capped by code points without splitting a character', () => {
    const urdu = 'ویڈیو'.repeat(60); // 300 code points
    const name = apply('{title}!', urdu);
    assert.equal(Array.from(name).length <= MAX_NAME_LENGTH, true);
    assert.equal(name.includes('�'), false);
    const emoji = '🎬'.repeat(200);
    const capped = apply('{title}!', emoji);
    assert.equal(Array.from(capped).length, MAX_NAME_LENGTH);
    assert.equal(capped, '🎬'.repeat(MAX_NAME_LENGTH));
  });

  test('leading and trailing separators and dots are removed', () => {
    assert.equal(sanitizeFileName(' - .Clip. - '), 'Clip');
    assert.equal(sanitizeFileName('...'), '');
  });

  test('render never returns an empty string', () => {
    assert.equal(renderFilenameTemplate('{quality}', {}), FALLBACK_NAME);
  });
});

describe('helpers', () => {
  test('normalizeFilenameTemplate caps and cleans', () => {
    assert.equal(normalizeFilenameTemplate('a\u0000b'), 'a b');
    assert.equal(Array.from(normalizeFilenameTemplate('x'.repeat(500))).length, MAX_TEMPLATE_LENGTH);
    assert.equal(normalizeFilenameTemplate(null), DEFAULT_FILENAME_TEMPLATE);
  });

  test('site label: page host without www, else a named site id', () => {
    assert.equal(templateSiteLabel('https://www.instagram.com/reel/x', 'instagram'), 'instagram.com');
    assert.equal(templateSiteLabel(null, 'tiktok'), 'tiktok');
    assert.equal(templateSiteLabel(null, 'web'), '');
    assert.equal(templateSiteLabel('not a url', null), '');
  });

  test('date and time use local time with file-safe separators', () => {
    assert.equal(formatTemplateDate(NOW), '2026-10-15');
    assert.equal(formatTemplateTime(NOW), '09-05');
  });

  test('an invalid clock leaves date and time empty', () => {
    assert.equal(apply('{title} {date} {time}', 'Clip', { now: new Date(Number.NaN) }), 'Clip');
  });
});
