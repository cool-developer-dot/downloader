import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyFilenameTemplate, renderFilenameTemplate } from './filename-template';

const NOW = new Date(2026, 0, 2, 3, 4);

describe('filename template (audit)', () => {
  test('a title that contains token text is never expanded', () => {
    assert.equal(
      applyFilenameTemplate({ template: '{title} [{quality}]', title: 'Clip {quality} {site}', qualityLabel: '720p', now: NOW }),
      'Clip {quality} {site} [720p]',
    );
  });

  test('a template of only separators and empty tokens falls back to the title', () => {
    assert.equal(applyFilenameTemplate({ template: ' - {quality} _ ', title: 'Clip', qualityLabel: null, now: NOW }), 'Clip');
  });

  test('a repeated token and unicode separators survive', () => {
    assert.equal(renderFilenameTemplate('{title}·{title}', { title: 'A' }), 'A·A');
  });

  test('an empty title with a custom template never yields an empty name', () => {
    assert.equal(applyFilenameTemplate({ template: '{title} {quality}', title: '', qualityLabel: null, now: NOW }), 'Video');
  });
});
