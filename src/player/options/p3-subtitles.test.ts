/**
 * P3's rows in the options sheet: all under Subtitles, in screen 21's order; sync and encoding follow the file showing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P3_OWNER, P3_PLAYER_OPTIONS } from './p3-subtitles.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const calls: string[] = [];
const ui: PlayerOptionUi = {
  stop: () => calls.push('stop'),
  openJumpToTime: () => calls.push('jump'),
  openSeekInterval: () => calls.push('interval'),
  openFrameByFrame: () => calls.push('frame'),
  openOrientation: () => calls.push('orientation'),
  openSpeed: () => calls.push('speed'),
  saveToLibrary: () => calls.push('save'),
  seekTo: () => calls.push('seek'),
  notAvailableYet: () => calls.push('notYet'),
  openAspectRatio: () => calls.push('aspectRatio'),
  openMirrorFlip: () => calls.push('mirrorFlip'),
  setFillCutout: (on) => calls.push(`fillCutout:${on}`),
  setInfoOverlay: (on) => calls.push(`infoOverlay:${on}`),
  openSubtitleTracks: () => calls.push('subtitleTracks'),
  loadSubtitleFile: () => calls.push('subtitleLoad'),
  setSubtitleAutoDetect: (on) => calls.push(`subtitleAutoDetect:${on}`),
  openSubtitleSync: () => calls.push('subtitleSync'),
  openSubtitleEncoding: () => calls.push('subtitleEncoding'),
  subtitlesOff: () => calls.push('subtitlesOff'),
  openSubtitleStyle: () => calls.push('subtitleStyle'),
  openSubtitleSecond: () => calls.push('subtitleSecond'),
};

const context = (subtitles: Partial<PlayerOptionContext['subtitles']> = {}): PlayerOptionContext => ({
  t: ((key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key) as PlayerOptionContext['t'],
  mediaId: 'm1',
  player: {} as PlayerOptionContext['player'],
  controller: {} as PlayerOptionContext['controller'],
  session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
  seekStepSeconds: 10,
  orientationMode: 'auto',
  incoming: null,
  display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
  subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null, ...subtitles },
  ui,
});

const rows = (ctx: PlayerOptionContext) =>
  Object.fromEntries(
    (playerOptions.sections(ctx).find((section) => section.section === 'subtitles')?.rows ?? []).map((entry) => [
      entry.row.id,
      { value: entry.value, enabled: entry.enabled, toggle: entry.toggle },
    ]),
  );

describe('P3 rows in the options sheet', () => {
  it('puts the subtitle rows under Subtitles in screen 21\'s order; Encoding and Off only when they apply', () => {
    const off = playerOptions.sections(context()).find((section) => section.section === 'subtitles');
    assert.deepEqual(off?.rows.map((entry) => entry.row.id), ['p3.track', 'p3.load', 'p3.autoDetect', 'p3.sync']);
    const file = playerOptions
      .sections(context({ label: 'Urdu · a.ur.srt', isFile: true, encodingLabel: 'Automatic (UTF-8)' }))
      .find((section) => section.section === 'subtitles');
    assert.deepEqual(file?.rows.map((entry) => entry.row.id), ['p3.track', 'p3.load', 'p3.autoDetect', 'p3.sync', 'p3.encoding', 'p3.off']);
    assert.ok(playerOptions.all().every((entry) => entry.owner === P3_OWNER));
  });

  it('shows the track, the offset and the encoding; sync is for subtitle files only', () => {
    const off = rows(context());
    assert.equal(off['p3.track']!.value, 'videoPlayer.subtitleOffValue');
    assert.equal(off['p3.sync']!.value, 'videoPlayer.subtitleSyncFileOnly');
    assert.equal(off['p3.sync']!.enabled, false);
    assert.equal(off['p3.autoDetect']!.toggle, true);
    const embedded = rows(context({ label: 'English · in the video' }));
    assert.equal(embedded['p3.track']!.value, 'English · in the video');
    assert.equal(embedded['p3.sync']!.enabled, false);
    assert.ok(embedded['p3.off']);
    const file = rows(context({ label: 'Urdu · a.ur.srt', isFile: true, offsetMs: 500, encodingLabel: 'Windows-1256' }));
    assert.equal(file['p3.sync']!.value, '+0.5 s');
    assert.equal(file['p3.sync']!.enabled, true);
    assert.equal(file['p3.encoding']!.value, 'Windows-1256');
  });

  it('runs the Player screen command each row stands for', () => {
    calls.length = 0;
    for (const option of P3_PLAYER_OPTIONS) {
      option.onPress(context({ autoDetect: true }));
    }
    assert.deepEqual(calls, [
      'subtitleTracks',
      'subtitleLoad',
      'subtitleAutoDetect:false',
      'subtitleSync',
      'subtitleEncoding',
      'subtitlesOff',
    ]);
  });
});
