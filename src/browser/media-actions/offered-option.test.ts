import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadQualityOption } from '@/downloads/quality/types';

import { pickOfferedQualityOption } from './offered-option';

function option(id: string, sourceUrl: string, height: number, downloadable = true): DownloadQualityOption {
  return { id, sourceUrl, height, width: null, downloadable, label: `${height}p` } as unknown as DownloadQualityOption;
}

test('a single tap downloads the offered source, not a larger one from another video on the page', () => {
  const offered = 'https://cdn.example.com/feature-480.mp4';
  const options = [
    option('ad', 'https://ads.example.com/preroll-1080.mp4', 1080),
    option('main', offered, 480),
  ];
  assert.equal(pickOfferedQualityOption(options, offered)?.id, 'main');
});

test('renditions of the offered manifest still compete by quality', () => {
  const mpd = 'https://cdn.example.com/v/manifest.mpd';
  const options = [option('r360', mpd, 360), option('r720', mpd, 720), option('other', 'https://x.example.com/a.mp4', 1080)];
  assert.equal(pickOfferedQualityOption(options, mpd)?.id, 'r720');
});

test('without an offered URL (or none matching) the best option is used, never an undownloadable one', () => {
  const options = [option('a', 'https://cdn.example.com/a.mp4', 480), option('b', 'https://cdn.example.com/b.mp4', 720)];
  assert.equal(pickOfferedQualityOption(options, null)?.id, 'b');
  assert.equal(pickOfferedQualityOption(options, 'https://cdn.example.com/gone.mp4')?.id, 'b');
  assert.equal(
    pickOfferedQualityOption([option('x', 'https://cdn.example.com/x.mp4', 720, false)], 'https://cdn.example.com/x.mp4'),
    null,
  );
});
