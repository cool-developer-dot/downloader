import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isYouTubeLink, shouldAnalyzePastedLink } from './pasted-link';

describe('which pasted links the direct analyzer reads first', () => {
  test('content pages and files on public hosts', () => {
    for (const url of [
      'https://www.instagram.com/reel/DdiUOZezpFs/',
      'https://m.facebook.com/watch/?v=2289516264908285',
      'https://www.tiktok.com/@scout2015/video/6718335390845095173',
      'https://vt.tiktok.com/ZSabc123/',
      'https://www.dailymotion.com/video/xb346be',
      'https://cdn.example/files/clip.mp4',
      'https://site.example/?v=12345',
    ]) {
      assert.equal(shouldAnalyzePastedLink(url), true, url);
    }
  });

  test('home pages, searches, YouTube, private hosts and other schemes load directly', () => {
    for (const url of [
      'https://www.instagram.com/',
      'https://example.com',
      'https://www.google.com/search?q=cats',
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'http://192.168.0.5/video.mp4',
      'http://localhost:8081/x',
      'http://router/admin',
      'file:///sdcard/x.mp4',
      'about:blank',
      'not a url',
      'https://site.example/?utm_source=x',
    ]) {
      assert.equal(shouldAnalyzePastedLink(url), false, url);
    }
  });
});

describe('YouTube links are refused at input', () => {
  test('every YouTube host, short link, Shorts/watch/embed link and app scheme', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/shorts/abcDEF12345',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      'https://music.youtube.com/watch?v=abc',
      'http://youtu.be/dQw4w9WgXcQ?si=xyz',
      'www.youtube.com/watch?v=abc',
      'youtu.be/abc',
      'https://www.youtube-nocookie.com/embed/abc',
      'https://rr3---sn-abc.googlevideo.com/videoplayback?id=1',
      'https://WWW.YOUTUBE.COM./watch?v=abc',
      'vnd.youtube:dQw4w9WgXcQ',
      'youtube://watch?v=abc',
      '  https://youtu.be/abc  ',
    ]) {
      assert.equal(isYouTubeLink(url), true, url);
    }
  });

  test('other sites, including look-alikes, are not refused', () => {
    for (const url of [
      'https://www.dailymotion.com/video/xb346be',
      'https://notyoutube.com/watch?v=abc',
      'https://youtube.com.evil.example/watch',
      'https://example.com/?next=https://youtube.com/watch',
      'https://www.google.com/search?q=youtube',
      'youtube tutorials',
      '',
      null,
    ]) {
      assert.equal(isYouTubeLink(url), false, String(url));
    }
  });
});
