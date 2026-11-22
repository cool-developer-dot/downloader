/**
 * P8's rows in the options sheet: Gestures, Gesture controls (the master switch) and Gesture sensitivity under
 * Playback (orders 100–190), Customize controls under Tools (80–89).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import { P8_OWNER, P8_PLAYER_OPTIONS } from './p8-gestures.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const calls: string[] = [];
const ui = new Proxy({} as PlayerOptionUi, {
  get:
    (_target, name: string) =>
    (...args: unknown[]) =>
      calls.push(args.length > 0 ? `${name}:${args.join(',')}` : name),
});

const context = (gestures: Partial<PlayerOptionContext['gestures']> = {}): PlayerOptionContext => ({
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
  subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
  gestures: { enabled: true, sensitivity: 'normal', onCount: 7, total: 7, ...gestures },
  ui,
});

const rows = (ctx: PlayerOptionContext) =>
  Object.fromEntries(
    playerOptions
      .sections(ctx)
      .flatMap((section) => section.rows)
      .map((entry) => [entry.row.id, { value: entry.value, toggle: entry.toggle, enabled: entry.enabled }]),
  );

describe('P8 rows in the options sheet', () => {
  it('puts the gesture rows after P1\'s under Playback and Customize controls under Tools', () => {
    const view = playerOptions.sections(context()).map((section) => [section.section, section.rows.map((entry) => entry.row.id)]);
    assert.deepEqual(view, [
      [
        'playback',
        ['p1.stop', 'p1.jumpToTime', 'p1.seekInterval', 'p1.frameByFrame', 'p8.gestures', 'p8.gestureControls', 'p8.gestureSensitivity'],
      ],
      ['video', ['p1.orientation']],
      ['tools', ['p8.customizeControls']],
    ]);
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P8_OWNER).map((entry) => entry.row.id),
      ['p8.gestures', 'p8.gestureControls', 'p8.gestureSensitivity', 'p8.customizeControls'],
    );
  });

  it('uses only its own order numbers (Playback 100–190, Tools 80–89)', () => {
    for (const row of P8_PLAYER_OPTIONS) {
      if (row.section === 'playback') {
        assert.ok(row.order >= 100 && row.order <= 190, row.id);
      } else {
        assert.equal(row.section, 'tools', row.id);
        assert.ok(row.order >= 80 && row.order <= 89, row.id);
      }
    }
  });

  it('sums up the gestures: all on, some on, off', () => {
    assert.equal(rows(context())['p8.gestures']!.value, 'videoPlayer.gesturesValueAll');
    assert.equal(rows(context({ onCount: 5 }))['p8.gestures']!.value, 'videoPlayer.gesturesValueSome(5,7)');
    assert.equal(rows(context({ enabled: false, onCount: 0 }))['p8.gestures']!.value, 'videoPlayer.gesturesValueOff');
    assert.equal(rows(context({ onCount: 0 }))['p8.gestures']!.value, 'videoPlayer.gesturesValueOff');
  });

  it('shows the master switch as a switch, and the sensitivity by name', () => {
    assert.equal(rows(context())['p8.gestureControls']!.toggle, true);
    assert.equal(rows(context({ enabled: false }))['p8.gestureControls']!.toggle, false);
    assert.equal(rows(context())['p8.gestureSensitivity']!.value, 'videoPlayer.gestureSensitivityNormal');
    assert.equal(rows(context({ sensitivity: 'low' }))['p8.gestureSensitivity']!.value, 'videoPlayer.gestureSensitivityLow');
    assert.equal(rows(context({ sensitivity: 'high' }))['p8.gestureSensitivity']!.value, 'videoPlayer.gestureSensitivityHigh');
    // Usable while the video is not ready: they are settings, not commands.
    const notReady = { ...context(), session: { ...context().session, isReady: false } };
    assert.ok(Object.entries(rows(notReady)).filter(([id]) => id.startsWith('p8.')).every(([, row]) => row.enabled));
  });

  it('opens its sheets and flips the master switch', () => {
    calls.length = 0;
    for (const option of P8_PLAYER_OPTIONS) {
      option.onPress(context());
    }
    option(P8_PLAYER_OPTIONS, 'p8.gestureControls').onPress(context({ enabled: false }));
    assert.deepEqual(calls, [
      'openGestures',
      'setGesturesEnabled:false',
      'openGestureSensitivity',
      'openCustomizeControls',
      'setGesturesEnabled:true',
    ]);
  });
});

function option(list: typeof P8_PLAYER_OPTIONS, id: string) {
  const found = list.find((row) => row.id === id);
  assert.ok(found, id);
  return found;
}
