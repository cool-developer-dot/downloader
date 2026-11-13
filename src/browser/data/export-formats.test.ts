import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { csvCell, historyCsv } from './history-csv';
import { escapeHtml, netscapeBookmarksHtml } from './netscape-bookmarks';

describe('bookmark file', () => {
  test('a Netscape file with the bookmarks in one folder, text escaped', () => {
    const html = netscapeBookmarksHtml(
      'VidoraX — Work',
      [
        { url: 'https://example.com/?a=1&b="2"', title: '<b>Tom & Jerry</b>', createdAt: '2026-10-01T00:00:00.000Z' },
        { url: 'javascript:alert(1)', title: 'never', createdAt: '' },
        { url: 'https://ur.wikipedia.org/', title: '', createdAt: 'bad' },
      ],
      new Date('2026-11-01T00:00:00.000Z'),
    );
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.match(html, /<H3 ADD_DATE="1793491200" LAST_MODIFIED="1793491200">VidoraX — Work<\/H3>/);
    assert.match(
      html,
      /<A HREF="https:\/\/example\.com\/\?a=1&amp;b=&quot;2&quot;" ADD_DATE="1790812800">&lt;b&gt;Tom &amp; Jerry&lt;\/b&gt;<\/A>/,
    );
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /<A HREF="https:\/\/ur\.wikipedia\.org\/" ADD_DATE="0">https:\/\/ur\.wikipedia\.org\/<\/A>/);
    assert.equal(escapeHtml('"<&>'), '&quot;&lt;&amp;&gt;');
  });
});

describe('history CSV', () => {
  test('BOM, CRLF, quoting and formula protection', () => {
    const csv = historyCsv(
      [
        { title: 'Lahore, Pakistan', url: 'https://example.com/a', visitedAt: '2026-10-31T12:00:00.000Z' },
        { title: '=HYPERLINK("x")', url: 'https://example.com/b', visitedAt: '2026-10-31T12:01:00.000Z' },
        { title: 'لاہور', url: 'https://ur.example/', visitedAt: '2026-10-31T12:02:00.000Z' },
      ],
      { title: 'Title', url: 'Address', visitedAt: 'Visited' },
    );
    assert.ok(csv.startsWith('﻿Title,Address,Visited\r\n'));
    assert.ok(csv.includes('"Lahore, Pakistan",https://example.com/a,2026-10-31T12:00:00.000Z\r\n'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")",https://example.com/b`));
    assert.ok(csv.includes('لاہور,https://ur.example/'));
    assert.ok(csv.endsWith('\r\n'));
  });

  test('cells', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('-1'), "'-1");
    assert.equal(csvCell('@x'), "'@x");
    assert.equal(csvCell('a\nb'), '"a\nb"');
  });
});
