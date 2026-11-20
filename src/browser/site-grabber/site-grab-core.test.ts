import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageVideoLinks, parseRobots, robotsAllow, sameSite, SiteCrawlQueue, sitePageLinks } from './site-grab-core';

test('robots.txt: the VidoraX group wins over *, the longest rule decides, Allow on a tie', () => {
  const robots = parseRobots(`
    User-agent: *
    Disallow: /private
    Allow: /private/open
    Disallow: /*.php$

    User-agent: Googlebot
    Disallow: /
  `);
  assert.equal(robotsAllow(robots, 'https://a.test/'), true);
  assert.equal(robotsAllow(robots, 'https://a.test/private/x'), false);
  assert.equal(robotsAllow(robots, 'https://a.test/private/open/y'), true);
  assert.equal(robotsAllow(robots, 'https://a.test/index.php'), false);
  assert.equal(robotsAllow(robots, 'https://a.test/index.php?x=1'), true, '$ anchors the end');
  const mine = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: VidoraX\nDisallow: /tmp\n');
  assert.equal(robotsAllow(mine, 'https://a.test/page'), true);
  assert.equal(robotsAllow(mine, 'https://a.test/tmp/a'), false);
  assert.equal(robotsAllow(parseRobots('User-agent: *\nDisallow:\n'), 'https://a.test/x'), true, 'an empty Disallow allows all');
  const shared = parseRobots('User-agent: a\nUser-agent: *\nDisallow: /b\n');
  assert.equal(robotsAllow(shared, 'https://a.test/b/1'), false, 'agents listed together share the rules');
});

test('page links: same site only, no files, fragments, account pages or nofollow links', () => {
  const html = `<base href="/section/">
    <a href="one.html#top">1</a><a href="https://www.site.test/two">2</a><a href="https://other.test/x">x</a>
    <a href="/img/a.jpg">pic</a><a href="/login">in</a><a rel="nofollow" href="/hidden">h</a>
    <a href="/clip.mp4">clip</a><a href="mailto:a@b.c">m</a><a href='/three?p=2&amp;q=1'>3</a>
    <a class="download-btn" href="/four">4</a><a href="/file-page" download>f</a>`;
  assert.deepEqual(sitePageLinks(html, 'https://site.test/start'), [
    'https://site.test/section/one.html',
    'https://www.site.test/two',
    'https://site.test/three?p=2&q=1',
    'https://site.test/four',
  ]);
  assert.equal(sameSite('https://www.a.test/x', 'http://a.test/y'), true);
  assert.equal(sameSite('https://b.a.test/x', 'https://a.test/y'), false);
});

test('page videos: video tags, Open Graph and file links, once each', () => {
  const html = `<title>Clip &amp; more</title><video src="/v/a.mp4?sig=1"></video><source data-src="/v/a.mp4?sig=2">
    <meta property="og:video:secure_url" content="https://cdn.test/b.m3u8"><a href="/files/c.mkv">c</a><a href="/page">p</a>`;
  const videos = pageVideoLinks(html, 'https://site.test/watch');
  assert.deepEqual(
    videos.map((v) => v.url),
    ['https://site.test/v/a.mp4?sig=1', 'https://cdn.test/b.m3u8', 'https://site.test/files/c.mkv'],
  );
  assert.equal(videos[0]?.title, 'Clip & more');
});

test('the crawl queue: breadth first, each page once, depth and page limits', () => {
  const queue = new SiteCrawlQueue('https://a.test/', 3, 1);
  assert.deepEqual(queue.next(), { url: 'https://a.test/', depth: 0 });
  queue.offer('https://a.test/1', 1);
  queue.offer('https://a.test/1/', 1);
  queue.offer('https://a.test/deep', 2);
  queue.offer('https://a.test/2', 1);
  queue.offer('https://a.test/3', 1);
  assert.equal(queue.next()?.url, 'https://a.test/1');
  assert.equal(queue.next()?.url, 'https://a.test/2');
  assert.equal(queue.next(), null, 'three pages at most');
  assert.equal(queue.done, 3);
});
