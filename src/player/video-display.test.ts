/**
 * P2 Video fit & display: fit / crop / stretch / forced ratios (#564–#566), the per-video memory, mirror / flip
 * (#573), keeping the picture clear of the camera cutout (#576) and the info overlay's rows (#721).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_VIDEO_FIT,
  MAX_REMEMBERED_FITS,
  MIRROR_MODES,
  VIDEO_FITS,
  displayedAspect,
  fitFor,
  fitRatio,
  formatBitrate,
  formatFrameRate,
  mirrorScale,
  normalizeVideoFit,
  pictureArea,
  ratioBox,
  readRememberedFits,
  rememberFit,
  videoCodecName,
  videoFitLayout,
  videoInfoRows,
  videoInfoSummary,
  videoRangeLabel,
  type VideoInfoInput,
} from './video-display.ts';

const SCREEN = { width: 800, height: 360 }; // a 20:9 phone in landscape, in dp
const HD = { width: 1920, height: 1080 };

describe('video fit', () => {
  it('offers fit, crop, stretch and four forced ratios (#564: 16:9, 4:3, and 21:9, 1:1), fit first and by default', () => {
    assert.deepEqual([...VIDEO_FITS], ['fit', 'crop', 'stretch', '16:9', '4:3', '21:9', '1:1']);
    assert.equal(fitRatio('1:1'), 1);
    assert.deepEqual(videoFitLayout(SCREEN, HD, '1:1').frame, { x: 220, y: 0, width: 360, height: 360 });
    assert.equal(DEFAULT_VIDEO_FIT, 'fit');
    assert.equal(normalizeVideoFit('4:3'), '4:3');
    assert.equal(normalizeVideoFit('zoom'), 'fit');
    assert.equal(normalizeVideoFit(undefined), 'fit');
    assert.equal(fitRatio('16:9'), 16 / 9);
    assert.equal(fitRatio('crop'), null);
  });

  it('fit: the whole picture in its own shape, over the whole surface (bars at the sides)', () => {
    const layout = videoFitLayout(SCREEN, HD, 'fit');
    assert.equal(layout.contentFit, 'contain');
    assert.equal(layout.fullSurface, true);
    assert.deepEqual(layout.frame, { x: 0, y: 0, width: 800, height: 360 });
    assert.deepEqual(layout.content, { width: 640, height: 360 });
  });

  it('#565 crop to fill: covers the surface (no bars); zoom pans inside what is visible, never past a black edge', () => {
    const layout = videoFitLayout(SCREEN, HD, 'crop');
    assert.equal(layout.contentFit, 'cover');
    assert.equal(layout.fullSurface, true);
    // The covering picture (800 × 450) is clipped to the frame, so the frame is what zoom can pan over.
    assert.deepEqual(layout.content, SCREEN);
    const clear = videoFitLayout(SCREEN, HD, 'crop', { top: 0, right: 0, bottom: 0, left: 32 });
    assert.deepEqual(clear.content, { width: 736, height: 360 });
  });

  it('#566 stretch: fills the surface exactly, shape not kept', () => {
    const layout = videoFitLayout(SCREEN, HD, 'stretch');
    assert.equal(layout.contentFit, 'fill');
    assert.deepEqual(layout.content, SCREEN);
  });

  it('#564 a forced ratio: the largest box of that shape, centred, the picture stretched into it', () => {
    const four = videoFitLayout(SCREEN, HD, '4:3');
    assert.equal(four.contentFit, 'fill');
    assert.equal(four.fullSurface, false);
    assert.deepEqual(four.frame, { x: 160, y: 0, width: 480, height: 360 });
    assert.deepEqual(four.content, { width: 480, height: 360 });
    // Wider than the screen: full width, bars above and below.
    const wide = videoFitLayout({ width: 640, height: 360 }, HD, '21:9');
    assert.equal(wide.frame.width, 640);
    assert.ok(Math.abs(wide.frame.height - 640 / (21 / 9)) < 1e-9);
    assert.ok(Math.abs(wide.frame.y - (360 - wide.frame.height) / 2) < 1e-9);
  });

  it('copes with an unknown picture or an unmeasured surface', () => {
    assert.deepEqual(videoFitLayout(SCREEN, null, 'fit').content, SCREEN);
    assert.deepEqual(videoFitLayout(SCREEN, null, 'crop').content, SCREEN);
    const empty = videoFitLayout({ width: 0, height: 0 }, HD, '16:9');
    assert.deepEqual(empty.frame, { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(empty.fullSurface, false);
    assert.deepEqual(ratioBox({ x: 0, y: 0, width: 100, height: 50 }, 0), { x: 0, y: 0, width: 100, height: 50 });
  });

  it('gives the shape a card or window should follow: a forced ratio reshapes it', () => {
    assert.deepEqual(displayedAspect('fit', HD), HD);
    assert.deepEqual(displayedAspect('crop', HD), HD);
    assert.deepEqual(displayedAspect('4:3', HD), { width: 4 / 3, height: 1 });
    assert.equal(displayedAspect('fit', null), null);
  });
});

describe('#576 notch / cutout', () => {
  const cutout = { top: 0, right: 0, bottom: 0, left: 32 };

  it('keeps the picture clear of the cutout and centred (the larger inset on both sides)', () => {
    assert.deepEqual(pictureArea(SCREEN, cutout), { x: 32, y: 0, width: 736, height: 360 });
    const layout = videoFitLayout(SCREEN, { width: 2560, height: 1080 }, 'crop', cutout);
    assert.equal(layout.fullSurface, false);
    assert.deepEqual(layout.frame, { x: 32, y: 0, width: 736, height: 360 });
    // A portrait phone in full screen: a camera at the top.
    assert.deepEqual(pictureArea({ width: 360, height: 800 }, { top: 40, right: 0, bottom: 16, left: 0 }), {
      x: 0,
      y: 40,
      width: 360,
      height: 720,
    });
  });

  it('uses the whole surface with no insets, and ignores insets that leave nothing', () => {
    assert.deepEqual(pictureArea(SCREEN, null), { x: 0, y: 0, width: 800, height: 360 });
    assert.equal(videoFitLayout(SCREEN, HD, 'fit', null).fullSurface, true);
    assert.deepEqual(pictureArea({ width: 50, height: 50 }, { top: 0, right: 0, bottom: 0, left: 40 }), {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    assert.deepEqual(pictureArea(SCREEN, { top: Number.NaN, right: -5, bottom: 0, left: 0 }), {
      x: 0,
      y: 0,
      width: 800,
      height: 360,
    });
  });
});

describe('fit remembered per video', () => {
  it('remembers a choice, moves it to the newest end, and forgets it when set back to fit', () => {
    let list = rememberFit([], 'a', 'crop');
    list = rememberFit(list, 'b', '4:3');
    list = rememberFit(list, 'a', 'stretch');
    assert.deepEqual(list, [
      ['b', '4:3'],
      ['a', 'stretch'],
    ]);
    assert.equal(fitFor(list, 'a'), 'stretch');
    assert.equal(fitFor(list, 'c'), 'fit');
    assert.equal(fitFor(list, null), 'fit');
    list = rememberFit(list, 'b', 'fit');
    assert.deepEqual(list, [['a', 'stretch']]);
  });

  it(`keeps the last ${MAX_REMEMBERED_FITS} videos, forgetting the oldest`, () => {
    let list = rememberFit([], 'first', 'crop', 3);
    for (const id of ['b', 'c', 'd']) list = rememberFit(list, id, 'crop', 3);
    assert.deepEqual(
      list.map(([id]) => id),
      ['b', 'c', 'd'],
    );
  });

  it('reads stored data defensively: drops junk, defaults and repeats (the latest wins)', () => {
    const raw = [['a', 'crop'], ['b', 'fit'], ['c', 'zoom'], [1, 'crop'], 'x', ['a', '21:9'], ['d', 'stretch', 1], ['e', '4:3']];
    assert.deepEqual(readRememberedFits(raw), [
      ['a', '21:9'],
      ['e', '4:3'],
    ]);
    assert.deepEqual(readRememberedFits(null), []);
    assert.deepEqual(readRememberedFits({ a: 'crop' }), []);
    assert.deepEqual(
      readRememberedFits([['a', 'crop'], ['b', 'crop'], ['c', 'crop']], 2).map(([id]) => id),
      ['b', 'c'],
    );
  });
});

describe('#573 mirror / flip', () => {
  it('mirrors left ↔ right, flips upside down, or both', () => {
    assert.deepEqual([...MIRROR_MODES], ['none', 'horizontal', 'vertical', 'both']);
    assert.deepEqual(mirrorScale('none'), { scaleX: 1, scaleY: 1 });
    assert.deepEqual(mirrorScale('horizontal'), { scaleX: -1, scaleY: 1 });
    assert.deepEqual(mirrorScale('vertical'), { scaleX: 1, scaleY: -1 });
    assert.deepEqual(mirrorScale('both'), { scaleX: -1, scaleY: -1 });
  });
});

describe('#721 info overlay', () => {
  const input = (overrides: Partial<VideoInfoInput> = {}): VideoInfoInput => ({
    mimeType: 'video/avc',
    width: 1920,
    height: 1080,
    frameRate: 29.97002997,
    averageBitrate: 4_213_000,
    peakBitrate: null,
    videoRange: 'sdr',
    playbackRate: 1,
    ...overrides,
  });

  it('names the common codecs, and an unknown one by its type', () => {
    assert.equal(videoCodecName('video/avc'), 'H.264');
    assert.equal(videoCodecName('VIDEO/HEVC'), 'H.265 (HEVC)');
    assert.equal(videoCodecName('video/x-vnd.on2.vp9'), 'VP9');
    assert.equal(videoCodecName('video/av01'), 'AV1');
    assert.equal(videoCodecName('video/x-foo'), 'X-FOO');
    assert.equal(videoCodecName(''), null);
    assert.equal(videoCodecName(null), null);
  });

  it('formats bit rate, frame rate and dynamic range', () => {
    assert.equal(formatBitrate(4_213_000), '4.2 Mb/s');
    assert.equal(formatBitrate(120_400_000), '120 Mb/s');
    assert.equal(formatBitrate(850_000), '850 kb/s');
    assert.equal(formatBitrate(300), '1 kb/s');
    assert.equal(formatBitrate(0), null);
    assert.equal(formatBitrate(Number.NaN), null);
    assert.equal(formatFrameRate(30), '30 fps');
    assert.equal(formatFrameRate(29.97002997), '29.97 fps');
    assert.equal(formatFrameRate(23.976023), '23.976 fps');
    assert.equal(formatFrameRate(null), null);
    assert.equal(videoRangeLabel('sdr'), 'SDR');
    assert.equal(videoRangeLabel('pq'), 'HDR (PQ)');
    assert.equal(videoRangeLabel('hlg'), 'HDR (HLG)');
    assert.equal(videoRangeLabel(undefined), null);
  });

  it('lists codec, size, frame rate, bit rate, range and speed, in that order (also as one line)', () => {
    assert.equal(videoInfoSummary(videoInfoRows(input())), 'H.264 · 1920 × 1080 · 29.97 fps · 4.2 Mb/s · SDR · 1.0×');
    assert.deepEqual(videoInfoRows(input({ playbackRate: 1.5 })), [
      { key: 'codec', value: 'H.264' },
      { key: 'resolution', value: '1920 × 1080' },
      { key: 'frameRate', value: '29.97 fps' },
      { key: 'bitrate', value: '4.2 Mb/s' },
      { key: 'range', value: 'SDR' },
      { key: 'speed', value: '1.5×' },
    ]);
  });

  it('leaves out what the player does not know, and uses the peak bit rate when the average is unknown', () => {
    const rows = videoInfoRows(
      input({ mimeType: null, width: null, frameRate: null, averageBitrate: null, peakBitrate: 900_000, videoRange: null }),
    );
    assert.deepEqual(rows, [
      { key: 'bitrate', value: '900 kb/s' },
      { key: 'speed', value: '1.0×' },
    ]);
  });
});
