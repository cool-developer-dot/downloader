import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { useMediaDetectionStore } from '@/media-detection/stores';
import type { DetectedMedia } from '@/media-detection/types';

import { lookupLiveMediaTitle } from './live-media-title';

const PAGE = 'https://videos.example.com/app/second';

function media(url: string, title: string | null, pageUrl = PAGE): DetectedMedia {
  return { id: url, url, sourceUrl: url, finalUrl: url, pageUrl, title } as unknown as DetectedMedia;
}

afterEach(() => {
  useMediaDetectionStore.getState().reset();
});

test('the download is named the way the live page names that same video now', () => {
  useMediaDetectionStore.setState({
    detectedMedia: [media('https://cdn.example.com/v/second.mp4?sig=new', 'Second clip')],
  });
  assert.equal(
    lookupLiveMediaTitle({ pageUrl: PAGE, sourceUrl: 'https://cdn.example.com/v/second.mp4?sig=old' }),
    'Second clip',
  );
});

test('no live name: another video, another page, or a nameless report', () => {
  useMediaDetectionStore.setState({
    detectedMedia: [
      media('https://cdn.example.com/v/other.mp4', 'Other clip'),
      media('https://cdn.example.com/v/second.mp4', 'Elsewhere', 'https://videos.example.com/app/else'),
      media('https://cdn.example.com/v/third.mp4', null),
    ],
  });
  assert.equal(lookupLiveMediaTitle({ pageUrl: PAGE, sourceUrl: 'https://cdn.example.com/v/second.mp4' }), null);
  assert.equal(lookupLiveMediaTitle({ pageUrl: PAGE, sourceUrl: 'https://cdn.example.com/v/third.mp4' }), null);
});
