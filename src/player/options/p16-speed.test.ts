import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import { P16_OWNER } from './p16-speed.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

let opened = 0;
const ui = new Proxy({} as PlayerOptionUi, {
  get: (_target, key) => (key === 'openSpeed' ? () => (opened += 1) : () => undefined),
});

const context = (rate: number, ready = true) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: ready, isPlaying: true, hasError: false, positionSeconds: 1, durationSeconds: 60, playbackRate: rate },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    ui,
  }) as unknown as PlayerOptionContext;

describe('P16 row in the options sheet', () => {
  it('puts Playback speed between Stop and Jump to time, with the speed now', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P16_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [['p16.speed', 'playback', 15]],
    );
    const rows = playerOptions.sections(context(1.35)).find((view) => view.section === 'playback')?.rows ?? [];
    assert.deepEqual(rows.slice(0, 3).map((entry) => entry.row.id), ['p1.stop', 'p16.speed', 'p1.jumpToTime']);
    assert.equal(rows[1].value, '1.35×');
    rows[1].row.onPress(context(1.35));
    assert.equal(opened, 1);
  });

  it('is greyed until the video is ready', () => {
    const rows = playerOptions.sections(context(1, false)).find((view) => view.section === 'playback')?.rows ?? [];
    assert.equal(rows.find((entry) => entry.row.id === 'p16.speed')?.enabled, false);
  });
});
