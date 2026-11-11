import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { namedTitleFor, setFilenameTemplateSource } from './filename-naming';

const REQUEST = { title: 'Beach clip', pageUrl: 'https://example.com/v/1', site: 'web' as const, qualityLabel: '1080p' };
const NOW = new Date(2026, 0, 2, 3, 4);

afterEach(() => setFilenameTemplateSource(null));

describe('namedTitleFor', () => {
  test('with nothing registered the title is unchanged', () => {
    assert.equal(namedTitleFor({ ...REQUEST, title: ' raw / title ' }, NOW), ' raw / title ');
  });

  test('the default template leaves the title unchanged', () => {
    setFilenameTemplateSource(() => '{title}');
    assert.equal(namedTitleFor({ ...REQUEST, title: ' raw / title ' }, NOW), ' raw / title ');
  });

  test('a custom template is applied', () => {
    setFilenameTemplateSource(() => '{site} - {title} [{quality}]');
    assert.equal(namedTitleFor(REQUEST, NOW), 'example.com - Beach clip [1080p]');
  });

  test('a failing source keeps the title', () => {
    setFilenameTemplateSource(() => {
      throw new Error('store not ready');
    });
    assert.equal(namedTitleFor(REQUEST, NOW), 'Beach clip');
  });
});
