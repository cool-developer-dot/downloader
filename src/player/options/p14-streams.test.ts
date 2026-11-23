import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { playerEngineEn } from '../../localization/catalogs/playerEngine.en.ts';
import { playerEngineUr } from '../../localization/catalogs/playerEngine.ur.ts';

import './p1-playback-basics.ts';
import './p2-video-fit.ts';
import './p10-edit-tools.ts';
import { P14_OWNER } from './p14-streams.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });
const calls: string[] = [];

const context = (stream: boolean) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: stream ? 'stream:0123456789abcdef0123456789abcdef' : 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    engine: {
      stream: stream
        ? { qualityLabel: 'Auto · 720p now', openQuality: () => calls.push('quality'), download: () => calls.push('download') }
        : null,
    },
    ui,
  }) as unknown as PlayerOptionContext;

const rowsOf = (ctx: PlayerOptionContext, section: string) =>
  playerOptions.sections(ctx).find((view) => view.section === section)?.rows ?? [];

describe('P14 rows in the options sheet', () => {
  it('registers Stream quality (Video, 60) and Download this stream (Tools, 15)', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P14_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [
        ['p14.streamQuality', 'video', 60],
        ['p14.downloadStream', 'tools', 15],
      ],
    );
  });

  it('shows both only for an online stream, with the live quality as the value', () => {
    const local = context(false);
    assert.equal(rowsOf(local, 'video').some((entry) => entry.row.id === 'p14.streamQuality'), false);
    assert.equal(rowsOf(local, 'tools').some((entry) => entry.row.id === 'p14.downloadStream'), false);

    const stream = context(true);
    const quality = rowsOf(stream, 'video').find((entry) => entry.row.id === 'p14.streamQuality');
    assert.equal(quality?.value, 'Auto · 720p now');
    quality?.row.onPress(stream);
    rowsOf(stream, 'tools').find((entry) => entry.row.id === 'p14.downloadStream')?.row.onPress(stream);
    assert.deepEqual(calls, ['quality', 'download']);
  });

  it('hides its rows when the engine part is missing (other packages’ contexts)', () => {
    const ctx = { ...context(true), engine: undefined } as PlayerOptionContext;
    assert.equal(rowsOf(ctx, 'video').some((entry) => entry.row.id.startsWith('p14.')), false);
  });

  it('has every string in English and Urdu', () => {
    assert.deepEqual(Object.keys(playerEngineUr).sort(), Object.keys(playerEngineEn).sort());
    for (const [key, value] of Object.entries(playerEngineUr)) {
      assert.ok(value.trim().length > 0, key);
    }
  });
});
