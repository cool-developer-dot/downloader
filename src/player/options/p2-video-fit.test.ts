/**
 * P2's rows in the options sheet: all under Video, after P1's orientation lock; the fit and mirror rows open the
 * Player's sheets, the info overlay and the notch area are on / off rows.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1_OWNER } from './p1-playback-basics.ts';
import { P2_OWNER, P2_PLAYER_OPTIONS } from './p2-video-fit.ts';
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
};

const context = (display: Partial<PlayerOptionContext['display']> = {}): PlayerOptionContext => ({
  t: ((key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key) as PlayerOptionContext['t'],
  mediaId: 'm1',
  player: {} as PlayerOptionContext['player'],
  controller: {} as PlayerOptionContext['controller'],
  session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
  seekStepSeconds: 10,
  orientationMode: 'auto',
  incoming: null,
  display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false, ...display },
  ui,
});

const videoRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'video')?.rows ?? [];

describe('P2 rows in the options sheet', () => {
  it('puts Aspect ratio, Mirror / Flip, Info overlay and Notch area under Video, after the orientation lock', () => {
    assert.deepEqual(
      videoRows(context()).map((entry) => entry.row.id),
      ['p1.orientation', 'p2.aspectRatio', 'p2.mirrorFlip', 'p2.infoOverlay', 'p2.notchArea'],
    );
    const owners = new Set(playerOptions.all().map((entry) => entry.owner));
    assert.deepEqual([...owners].sort(), [P1_OWNER, P2_OWNER]);
    assert.ok(P2_PLAYER_OPTIONS.every((row) => row.section === 'video'));
  });

  it('shows the fit and mirror chosen for this video as values', () => {
    const values = (display: Partial<PlayerOptionContext['display']>) =>
      Object.fromEntries(videoRows(context(display)).map((entry) => [entry.row.id, entry.value]));
    assert.equal(values({})['p2.aspectRatio'], 'videoPlayer.fitFit');
    assert.equal(values({ fit: 'crop' })['p2.aspectRatio'], 'videoPlayer.fitCrop');
    assert.equal(values({ fit: '21:9' })['p2.aspectRatio'], 'videoPlayer.fitRatio(21:9)');
    assert.equal(values({ mirror: 'both' })['p2.mirrorFlip'], 'videoPlayer.mirrorBoth');
  });

  it('draws the info overlay and the notch area as switches showing their state', () => {
    const toggles = (display: Partial<PlayerOptionContext['display']>) =>
      Object.fromEntries(videoRows(context(display)).map((entry) => [entry.row.id, entry.toggle]));
    assert.deepEqual(toggles({}), {
      'p1.orientation': null,
      'p2.aspectRatio': null,
      'p2.mirrorFlip': null,
      'p2.infoOverlay': false,
      'p2.notchArea': false,
    });
    const on = toggles({ infoOverlay: true, fillCutout: true });
    assert.equal(on['p2.infoOverlay'], true);
    assert.equal(on['p2.notchArea'], true);
  });

  it('opens the sheets, and flips the switches', () => {
    calls.length = 0;
    for (const option of P2_PLAYER_OPTIONS) {
      option.onPress(context({ infoOverlay: true }));
    }
    assert.deepEqual(calls, ['aspectRatio', 'mirrorFlip', 'infoOverlay:false', 'fillCutout:true']);
  });
});
