import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import './p9-library-stats.ts';
import { P15_OWNER } from './p15-headset-keys.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });
let opened = 0;

const context = (withEngine: boolean) =>
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
    engine: withEngine ? { stream: null, headsetKeys: { open: () => (opened += 1) } } : undefined,
    ui,
  }) as unknown as PlayerOptionContext;

describe('P15 row in the options sheet', () => {
  it('registers "Headset, keys & lock screen" at Playback 210, after P9’s history row', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P15_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [['p15.headsetKeys', 'playback', 210]],
    );
    const ids = playerOptions.sections(context(true)).find((view) => view.section === 'playback')?.rows.map((r) => r.row.id) ?? [];
    assert.equal(ids[ids.length - 1], 'p15.headsetKeys');
  });

  it('opens the sheet, and hides without the engine part', () => {
    const ctx = context(true);
    playerOptions.all().find((entry) => entry.row.id === 'p15.headsetKeys')?.row.onPress(ctx);
    assert.equal(opened, 1);
    const ids = playerOptions.sections(context(false)).flatMap((view) => view.rows.map((r) => r.row.id));
    assert.equal(ids.includes('p15.headsetKeys'), false);
  });
});
