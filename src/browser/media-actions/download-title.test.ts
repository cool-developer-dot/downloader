import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickDownloadTitle } from './download-title.ts';

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
