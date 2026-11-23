import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P17_OWNER } from './p17-audio.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });
const calls: string[] = [];

const context = (trackLabel: string | null, audioOnly = false) =>
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
      audio: {
        trackLabel,
        delayLabel: '+120 ms',
        audioOnly,
        setAudioOnly: (on: boolean) => calls.push(`audioOnly:${on}`),
        open: () => calls.push('open'),
      },
    },
    ui,
  }) as unknown as PlayerOptionContext;

const audioRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((view) => view.section === 'audio')?.rows ?? [];

describe('P17 rows in the options sheet', () => {
  it('fills the Audio section: track, delay, audio only', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P17_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [
        ['p17.audioTrack', 'audio', 10],
        ['p17.audioDelay', 'audio', 20],
        ['p17.audioOnly', 'audio', 30],
      ],
    );
    const rows = audioRows(context('English'));
    assert.deepEqual(rows.map((entry) => [entry.row.id, entry.value, entry.toggle]), [
      ['p17.audioTrack', 'English', null],
      ['p17.audioDelay', '+120 ms', null],
      ['p17.audioOnly', null, false],
    ]);
  });

  it('hides the track row for a video with one track, and flips Audio only', () => {
    const ctx = context(null, true);
    const rows = audioRows(ctx);
    assert.deepEqual(rows.map((entry) => entry.row.id), ['p17.audioDelay', 'p17.audioOnly']);
    assert.equal(rows[1].toggle, true);
    rows[1].row.onPress(ctx);
    rows[0].row.onPress(ctx);
    assert.deepEqual(calls, ['audioOnly:false', 'open']);
  });
});
