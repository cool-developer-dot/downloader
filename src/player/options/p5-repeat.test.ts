/**
 * P5's rows in the options sheet: "When the video ends" and A-B repeat, under Playback after P1's rows.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import { P5_OWNER, P5_PLAYER_OPTIONS } from './p5-repeat.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const calls: string[] = [];
const ui = new Proxy({} as PlayerOptionUi, {
  get: (_target, name: string) => () => calls.push(name),
});

const context = (repeat: PlayerOptionContext['repeat'] | 'none' = { endActionLabel: 'Repeat one', abLabel: '0:10–0:25' }) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    repeat: repeat === 'none' ? undefined : repeat,
    ui,
  }) as PlayerOptionContext;

const playbackRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'playback')?.rows ?? [];

describe('P5 rows in the options sheet', () => {
  it('puts When the video ends and A-B repeat after P1’s Playback rows', () => {
    const ids = playbackRows(context()).map((entry) => entry.row.id);
    assert.deepEqual(ids.slice(0, 6), [
      'p1.stop',
      'p1.jumpToTime',
      'p1.seekInterval',
      'p1.frameByFrame',
      'p5.endOfPlayback',
      'p5.abRepeat',
    ]);
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P5_OWNER).map((entry) => entry.row.id),
      ['p5.endOfPlayback', 'p5.abRepeat'],
    );
  });

  it('shows the choice and the loop, and opens their sheets', () => {
    const rows = playbackRows(context());
    assert.equal(rows.find((entry) => entry.row.id === 'p5.endOfPlayback')?.value, 'Repeat one');
    assert.equal(rows.find((entry) => entry.row.id === 'p5.abRepeat')?.value, '0:10–0:25');
    calls.length = 0;
    for (const option of P5_PLAYER_OPTIONS) {
      option.onPress(context());
    }
    assert.deepEqual(calls, ['openEndOfPlayback', 'openAbRepeat']);
  });

  it('stays hidden where a screen gives no repeat state', () => {
    const ids = playbackRows(context('none')).map((entry) => entry.row.id);
    assert.ok(!ids.includes('p5.endOfPlayback'));
    assert.ok(!ids.includes('p5.abRepeat'));
  });
});
