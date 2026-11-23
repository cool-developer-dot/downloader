import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import './p15-headset-keys.ts';
import { P18_OWNER } from './p18-sleep-limits.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });
const calls: string[] = [];

const context = () =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 1, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    engine: {
      stream: null,
      headsetKeys: { open: () => undefined },
      audio: { trackLabel: null, delayLabel: '0 ms', audioOnly: false, setAudioOnly: () => undefined, open: () => undefined },
      sleep: { valueLabel: '23 min left', open: () => calls.push('sleep') },
      limit: { valueLabel: '35 min left today', open: () => calls.push('limit') },
      kidLock: { start: () => calls.push('kid') },
    },
    ui,
  }) as unknown as PlayerOptionContext;

describe('P18 rows in the options sheet', () => {
  it('adds Sleep timer, Daily limit and Kid lock under Playback, before the Headset row', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P18_OWNER).map((entry) => [entry.row.id, entry.row.order]),
      [
        ['p18.sleepTimer', 140],
        ['p18.dailyLimit', 150],
        ['p18.kidLock', 160],
      ],
    );
    const rows = playerOptions.sections(context()).find((view) => view.section === 'playback')?.rows ?? [];
    const ids = rows.map((entry) => entry.row.id);
    assert.ok(ids.indexOf('p18.kidLock') < ids.indexOf('p15.headsetKeys'));
    assert.equal(rows.find((entry) => entry.row.id === 'p18.sleepTimer')?.value, '23 min left');
    assert.equal(rows.find((entry) => entry.row.id === 'p18.dailyLimit')?.value, '35 min left today');
    for (const id of ['p18.sleepTimer', 'p18.dailyLimit', 'p18.kidLock']) {
      rows.find((entry) => entry.row.id === id)?.row.onPress(context());
    }
    assert.deepEqual(calls, ['sleep', 'limit', 'kid']);
  });
});
