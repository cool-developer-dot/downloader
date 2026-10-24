import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { directMediaFileTitle, pickDownloadTitle } from './download-title.ts';

const PAGE = 'https://videos.example/watch/42';

test('a title detection found is kept', () => {
  assert.equal(
    pickDownloadTitle({ resolved: 'Sunset timelapse', pageUrl: PAGE, tabs: [{ url: PAGE, title: 'Other name' }] }),
    'Sunset timelapse',
  );
});

test('a download that would be called "Download" takes the title of the tab showing its page', () => {
  assert.equal(
    pickDownloadTitle({
      resolved: 'Download',
      pageUrl: PAGE,
      tabs: [
        { url: 'https://other.example/', title: 'Another page' },
        { url: `${PAGE}#t=10`, title: 'Harbour at dawn — Videos' },
      ],
    }),
    'Harbour at dawn — Videos',
  );
});

test('never a URL, never another page, never nothing', () => {
  assert.equal(
    pickDownloadTitle({ resolved: 'Download', pageUrl: PAGE, tabs: [{ url: PAGE, title: PAGE }] }),
    'Download',
    'the WebView shows the address as the title while a page loads',
  );
  assert.equal(
    pickDownloadTitle({ resolved: 'Download', pageUrl: PAGE, tabs: [{ url: PAGE, title: 'videos.example/watch/42' }] }),
    'Download',
  );
  assert.equal(
    pickDownloadTitle({ resolved: 'Download', pageUrl: PAGE, tabs: [{ url: 'https://videos.example/watch/43', title: 'Next video' }] }),
    'Download',
  );
  assert.equal(pickDownloadTitle({ resolved: 'Download', pageUrl: PAGE, tabs: [{ url: PAGE, title: '   ' }] }), 'Download');
  assert.equal(pickDownloadTitle({ resolved: 'Download', pageUrl: null, tabs: [{ url: PAGE, title: 'X' }] }), 'Download');
});

describe('directMediaFileTitle', () => {
  test('a video file or stream opened as the page is named by its file', () => {
    assert.equal(
      directMediaFileTitle('https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'),
      'Big_Buck_Bunny_360_10s_1MB',
    );
    assert.equal(directMediaFileTitle('https://cdn.example.com/films/My%20Trip%20(2024).webm?sig=1'), 'My Trip (2024)');
    assert.equal(directMediaFileTitle('https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd'), 'bbb_30fps');
  });

  test('a generic manifest name takes its folder name', () => {
    assert.equal(directMediaFileTitle('https://example.com/shows/episode-7/master.m3u8'), 'episode-7');
    assert.equal(directMediaFileTitle('https://demo.example.com/k8s/live/stable/live.isml/.m3u8'), 'live');
  });

  test('any other page keeps its own title', () => {
    assert.equal(directMediaFileTitle('https://www.w3schools.com/html/html5_video.asp'), null);
    assert.equal(directMediaFileTitle('https://example.com/'), null);
    assert.equal(directMediaFileTitle(null), null);
    assert.equal(directMediaFileTitle('not a url'), null);
  });
});
