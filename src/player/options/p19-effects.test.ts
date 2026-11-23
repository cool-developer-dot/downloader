import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p17-audio.ts';
import { P19_OWNER } from './p19-effects.ts';
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
      sleep: { valueLabel: 'Off', open: () => undefined },
      limit: { valueLabel: 'No limit', open: () => undefined },
      kidLock: { start: () => undefined },
      effects: {
        eqLabel: 'Rock',
        boostLabel: '150 %',
        nightMode: true,
        mono: false,
        set: (patch: object) => calls.push(JSON.stringify(patch)),
        open: () => calls.push('open'),
      },
    },
    ui,
  }) as unknown as PlayerOptionContext;

describe('P19 rows in the options sheet', () => {
  it('adds Equalizer, Volume boost, Night mode and Mono after P17’s rows', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P19_OWNER).map((entry) => [entry.row.id, entry.row.order]),
      [
        ['p19.equalizer', 40],
        ['p19.volumeBoost', 50],
        ['p19.nightMode', 60],
        ['p19.mono', 70],
      ],
    );
    const rows = playerOptions.sections(context()).find((view) => view.section === 'audio')?.rows ?? [];
    assert.deepEqual(rows.map((entry) => [entry.row.id, entry.value, entry.toggle]), [
      ['p17.audioDelay', '0 ms', null],
      ['p17.audioOnly', null, false],
      ['p19.equalizer', 'Rock', null],
      ['p19.volumeBoost', '150 %', null],
      ['p19.nightMode', null, true],
      ['p19.mono', null, false],
    ]);
    rows[2].row.onPress(context());
    rows[4].row.onPress(context());
    rows[5].row.onPress(context());
    assert.deepEqual(calls, ['open', '{"nightMode":false}', '{"mono":true}']);
  });
});
