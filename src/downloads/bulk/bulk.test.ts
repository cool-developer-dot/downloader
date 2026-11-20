import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EMPTY_LINK_RULES, linkRuleSkip, normalizeLinkRules, parseRuleList, sizeAllowed } from './link-rules';
import { looksLikePlaylistUrl, parsePlaylist } from './playlist-parse';
import { expandUrlPattern, isUrlPattern, MAX_PATTERN_LINKS } from './url-pattern';

describe('#485 pattern download', () => {
  test('a zero-padded range keeps its width, in order', () => {
    const out = expandUrlPattern('https://cdn.example.com/clip[001-003].mp4');
    assert.deepEqual(out.urls, ['https://cdn.example.com/clip001.mp4', 'https://cdn.example.com/clip002.mp4', 'https://cdn.example.com/clip003.mp4']);
    assert.equal(out.total, 3);
    assert.equal(out.truncated, false);
  });

  test('steps, letters, alternatives and several ranges multiply', () => {
    assert.deepEqual(expandUrlPattern('https://x.test/p[1-7:3].mp4').urls, ['https://x.test/p1.mp4', 'https://x.test/p4.mp4', 'https://x.test/p7.mp4']);
    assert.deepEqual(expandUrlPattern('https://x.test/[a-c].mp4').urls.length, 3);
    assert.deepEqual(expandUrlPattern('https://x.test/{low,high}.mp4').urls, ['https://x.test/low.mp4', 'https://x.test/high.mp4']);
    const grid = expandUrlPattern('https://x.test/s[1-2]e[01-03].mkv');
    assert.equal(grid.total, 6);
    assert.equal(grid.urls[0], 'https://x.test/s1e01.mkv');
    assert.equal(grid.urls[5], 'https://x.test/s2e03.mkv');
  });

  test('a huge pattern is capped, a non-link or a plain bracket is not a pattern', () => {
    const big = expandUrlPattern('https://x.test/[1-100000].mp4');
    assert.equal(big.urls.length, MAX_PATTERN_LINKS);
    assert.equal(big.truncated, true);
    assert.equal(expandUrlPattern('clip[1-3].mp4').urls.length, 0);
    assert.equal(isUrlPattern('https://[::1]/a.mp4'), false);
    assert.equal(isUrlPattern('https://x.test/a[1-2].mp4'), true);
  });
});

describe('#505 include/exclude rules', () => {
  test('no rules let everything through', () => {
    assert.equal(linkRuleSkip('https://x.test/a.mp4', EMPTY_LINK_RULES), null);
    assert.equal(sizeAllowed(10 * 1024 * 1024, EMPTY_LINK_RULES), true);
  });

  test('extensions, keywords and patterns, each way', () => {
    const rules = {
      ...EMPTY_LINK_RULES,
      includeExtensions: parseRuleList('mp4, .MKV'),
      excludeKeywords: ['trailer'],
      excludePattern: 'sample\\d+',
    };
    assert.equal(linkRuleSkip('https://x.test/movie.mp4', rules), null);
    assert.equal(linkRuleSkip('https://x.test/movie.webm', rules), 'extension');
    assert.equal(linkRuleSkip('https://x.test/Trailer.mp4', rules), 'keyword');
    assert.equal(linkRuleSkip('https://x.test/sample12.mkv', rules), 'pattern');
    assert.equal(linkRuleSkip('https://x.test/clip.mp4', { ...EMPTY_LINK_RULES, includeKeywords: ['episode'] }), 'keyword');
  });

  test('an invalid regular expression is ignored, sizes are in MB, unknown size passes', () => {
    assert.equal(linkRuleSkip('https://x.test/a.mp4', { ...EMPTY_LINK_RULES, includePattern: '([' }), null);
    const rules = { ...EMPTY_LINK_RULES, minSizeMb: 5, maxSizeMb: 100 };
    assert.equal(sizeAllowed(4 * 1024 * 1024, rules), false);
    assert.equal(sizeAllowed(50 * 1024 * 1024, rules), true);
    assert.equal(sizeAllowed(200 * 1024 * 1024, rules), false);
    assert.equal(sizeAllowed(null, rules), true);
  });

  test('stored rules are cleaned', () => {
    assert.deepEqual(normalizeLinkRules(null), EMPTY_LINK_RULES);
    const rules = normalizeLinkRules({ includeExtensions: ['.MP4', 'mp4', 3], minSizeMb: -2, includePattern: 42 });
    assert.deepEqual(rules.includeExtensions, ['mp4']);
    assert.equal(rules.minSizeMb, 0);
    assert.equal(rules.includePattern, '');
  });
});

describe('#368/#369 playlists', () => {
  const base = 'https://cdn.example.com/lists/show.m3u';

  test('an extended M3U lists its files with titles, relative links resolved', () => {
    const parsed = parsePlaylist('#EXTM3U\n#EXTINF:120,Episode 1\nep1.mp4\n#EXTINF:-1,Episode 2\nhttps://other.example/ep2.mkv\n', base);
    assert.equal(parsed.kind, 'playlist');
    if (parsed.kind !== 'playlist') return;
    assert.deepEqual(parsed.entries, [
      { url: 'https://cdn.example.com/lists/ep1.mp4', title: 'Episode 1' },
      { url: 'https://other.example/ep2.mkv', title: 'Episode 2' },
    ]);
  });

  test('an HLS playlist is a stream, never split into segments', () => {
    assert.deepEqual(parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n', base), { kind: 'hls' });
    assert.deepEqual(parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n', base), { kind: 'hls' });
  });

  test('PLS and XSPF', () => {
    const pls = parsePlaylist('[playlist]\nFile2=b.mp4\nFile1=a.mp4\nTitle1=First\nNumberOfEntries=2\n', base);
    assert.equal(pls.kind === 'playlist' && pls.entries.map((e) => e.url).join(' '), 'https://cdn.example.com/lists/a.mp4 https://cdn.example.com/lists/b.mp4');
    const xspf = parsePlaylist(
      '<?xml version="1.0"?><playlist version="1"><trackList><track><location>https://x.test/a.mp4?x=1&amp;y=2</location><title><![CDATA[One & two]]></title></track></trackList></playlist>',
      base,
    );
    assert.equal(xspf.kind, 'playlist');
    if (xspf.kind === 'playlist') assert.deepEqual(xspf.entries[0], { url: 'https://x.test/a.mp4?x=1&y=2', title: 'One & two' });
  });

  test('an HTML page or prose is not a playlist; names hint, bytes decide', () => {
    assert.equal(parsePlaylist('<html><body>hi</body></html>', base).kind, 'none');
    assert.equal(parsePlaylist('Watch https://x.test/a.mp4 today', base).kind, 'none');
    assert.equal(looksLikePlaylistUrl('https://x.test/list.PLS?x=1'), true);
    assert.equal(looksLikePlaylistUrl('https://x.test/clip.mp4'), false);
  });
});

describe('Batch Add text', () => {
  test('plain links and pattern lines together, in order, without duplicates', async () => {
    const { batchLinksFromText } = await import('./batch-text');
    const out = batchLinksFromText('https://x.test/a.mp4\nhttps://x.test/p[1-3].mp4\nsee https://x.test/a.mp4 again\n');
    assert.deepEqual(out.links, ['https://x.test/a.mp4', 'https://x.test/p1.mp4', 'https://x.test/p2.mp4', 'https://x.test/p3.mp4']);
    assert.equal(out.truncated, false);
    const capped = batchLinksFromText('https://x.test/p[1-900].mp4');
    assert.equal(capped.links.length, 500);
    assert.equal(capped.truncated, true);
  });

  test('#347: a `link | mirror` line is one link with its mirrors, beside patterns', async () => {
    const { batchLinksFromText } = await import('./batch-text');
    const out = batchLinksFromText(
      'https://x.test/a.mp4 | https://m1.test/a.mp4 | https://m2.test/a.mp4\nhttps://x.test/p[1-2].mp4\nhttps://x.test/b.mp4 | https://x.test/b.mp4',
    );
    assert.deepEqual(out.links, ['https://x.test/a.mp4', 'https://x.test/p1.mp4', 'https://x.test/p2.mp4', 'https://x.test/b.mp4']);
    assert.deepEqual(out.mirrors, { 'https://x.test/a.mp4': ['https://m1.test/a.mp4', 'https://m2.test/a.mp4'] });
  });
});

test('#363: an RSS or Atom feed opened as a playlist gives its video enclosures, not its audio items', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>C</title>
    <item><title>One &amp; two &amp;#039;x&amp;#x27;</title><enclosure url="/v/1.mp4" type="video/mp4"/></item>
    <item><title>Pod</title><enclosure url="https://cdn.test/p.mp3" type="audio/mpeg"/></item>
    <item><title>Three</title><media:content url="https://cdn.test/3.m3u8?a=1&amp;b=2" medium="video"/></item>
    <item><title>Page only</title><link>https://site.test/post</link></item>
  </channel></rss>`;
  const parsed = parsePlaylist(rss, 'https://site.test/feed.xml');
  assert.equal(parsed.kind, 'playlist');
  assert.ok(parsed.kind === 'playlist' && parsed.format === 'feed');
  assert.deepEqual(parsed.kind === 'playlist' ? parsed.entries : [], [
    { url: 'https://site.test/v/1.mp4', title: "One & two 'x'" },
    { url: 'https://cdn.test/3.m3u8?a=1&b=2', title: 'Three' },
  ]);
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="enclosure" type="video/webm" href="https://cdn.test/a.webm"/></entry></feed>`;
  const parsedAtom = parsePlaylist(atom, 'https://site.test/atom');
  assert.deepEqual(parsedAtom.kind === 'playlist' ? parsedAtom.entries.map((e) => e.url) : [], ['https://cdn.test/a.webm']);
  assert.equal(looksLikePlaylistUrl('https://site.test/videos/feed/'), true);
  assert.equal(looksLikePlaylistUrl('https://site.test/podcast.rss'), true);
  assert.equal(looksLikePlaylistUrl('https://feeds.site.test/show_video_hd.xml'), true);
  assert.equal(looksLikePlaylistUrl('https://site.test/feedback'), false);
});
